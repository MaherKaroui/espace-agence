-- Journal détaillé des tentatives Web Push par notification / destinataire / appareil
CREATE TABLE IF NOT EXISTS public.push_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL,
  user_id uuid NOT NULL,
  subscription_id uuid,
  endpoint_host text,
  endpoint_hash text,
  status text NOT NULL DEFAULT 'pending',
  http_status integer,
  error_message text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.push_delivery_logs TO authenticated;
GRANT ALL ON public.push_delivery_logs TO service_role;
ALTER TABLE public.push_delivery_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_delivery_logs_staff_read" ON public.push_delivery_logs;
CREATE POLICY "push_delivery_logs_staff_read"
ON public.push_delivery_logs
FOR SELECT
TO authenticated
USING (public.is_agency_member(auth.uid()) OR user_id = auth.uid());
CREATE INDEX IF NOT EXISTS push_delivery_logs_notification_idx ON public.push_delivery_logs (notification_id, created_at DESC);
CREATE INDEX IF NOT EXISTS push_delivery_logs_user_idx ON public.push_delivery_logs (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_key ON public.push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON public.push_subscriptions (user_id);

CREATE OR REPLACE FUNCTION public.save_push_subscription(
  _endpoint text,
  _p256dh text,
  _auth text,
  _user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;
  IF COALESCE(NULLIF(_endpoint, ''), '') = '' OR COALESCE(NULLIF(_p256dh, ''), '') = '' OR COALESCE(NULLIF(_auth, ''), '') = '' THEN
    RAISE EXCEPTION 'Abonnement push incomplet';
  END IF;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
  VALUES (auth.uid(), _endpoint, _p256dh, _auth, _user_agent, now())
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = auth.uid(),
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    last_used_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_notification_recipients_for_pole(_pole_id uuid, _exclude_user_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH pole_recipients AS (
    SELECT DISTINCT pm.user_id
    FROM public.pole_members pm
    JOIN public.profiles pr ON pr.id = pm.user_id
    JOIN public.user_roles ur ON ur.user_id = pm.user_id
    WHERE _pole_id IS NOT NULL
      AND pm.pole_id = _pole_id
      AND (_exclude_user_id IS NULL OR pm.user_id <> _exclude_user_id)
      AND pr.archived_at IS NULL
      AND ur.role IN ('manager'::public.app_role, 'consultant'::public.app_role, 'admin'::public.app_role, 'direction'::public.app_role)
  ),
  oversight_recipients AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE (_exclude_user_id IS NULL OR ur.user_id <> _exclude_user_id)
      AND pr.archived_at IS NULL
      AND ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
  )
  SELECT user_id FROM pole_recipients
  UNION
  SELECT user_id FROM oversight_recipients;
$$;

CREATE OR REPLACE FUNCTION public.team_notification_recipients_for_client(_client_id uuid, _exclude_user_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH client_poles AS (
    SELECT DISTINCT d.pole_id
    FROM public.dossiers d
    WHERE d.client_id = _client_id AND d.pole_id IS NOT NULL
  ),
  pole_recipients AS (
    SELECT DISTINCT r.user_id
    FROM client_poles cp
    CROSS JOIN LATERAL public.team_notification_recipients_for_pole(cp.pole_id, _exclude_user_id) r
  ),
  fallback_recipients AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE NOT EXISTS (SELECT 1 FROM pole_recipients)
      AND (_exclude_user_id IS NULL OR ur.user_id <> _exclude_user_id)
      AND pr.archived_at IS NULL
      AND ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
  )
  SELECT user_id FROM pole_recipients
  UNION
  SELECT user_id FROM fallback_recipients;
$$;

CREATE OR REPLACE FUNCTION public.auto_create_task_for_new_dossier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing uuid;
  v_assignee uuid;
  v_creator uuid;
  v_client_name text;
  v_of_name text;
  v_task_id uuid;
  v_pole_nom text;
  v_no_member boolean;
BEGIN
  SELECT id INTO v_existing FROM public.agency_tasks WHERE dossier_id = NEW.id AND task_type = 'nouveau_dossier' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  SELECT pm.user_id INTO v_assignee
  FROM public.pole_members pm
  JOIN public.profiles pr ON pr.id = pm.user_id AND pr.archived_at IS NULL
  WHERE pm.pole_id = NEW.pole_id AND pm.role = 'manager'
  ORDER BY pm.created_at ASC LIMIT 1;

  IF v_assignee IS NULL THEN
    SELECT pm.user_id INTO v_assignee
    FROM public.pole_members pm
    JOIN public.profiles pr ON pr.id = pm.user_id AND pr.archived_at IS NULL
    WHERE pm.pole_id = NEW.pole_id AND pm.role = 'consultant'
    ORDER BY pm.created_at ASC LIMIT 1;
  END IF;

  v_no_member := v_assignee IS NULL;

  SELECT ur.user_id INTO v_creator
  FROM public.user_roles ur
  JOIN public.profiles pr ON pr.id = ur.user_id AND pr.archived_at IS NULL
  WHERE ur.role = 'admin'
  ORDER BY ur.id ASC LIMIT 1;

  IF v_creator IS NULL THEN v_creator := NEW.client_id; END IF;
  IF v_assignee IS NULL THEN v_assignee := v_creator; END IF;

  SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.prenom, p.nom)), ''), p.email) INTO v_client_name
  FROM public.profiles p WHERE p.id = NEW.client_id;

  v_of_name := NULLIF(TRIM(NEW.organisme_nom), '');
  SELECT nom INTO v_pole_nom FROM public.poles WHERE id = NEW.pole_id;

  INSERT INTO public.agency_tasks (title, description, priority, status, due_date, created_by, assigned_to, pole_id, client_id, dossier_id, auto, task_type)
  VALUES (
    'Nouveau dossier à traiter — ' || NEW.titre,
    'Client : ' || COALESCE(v_client_name, '—') || E'\n' || 'Organisme de formation : ' || COALESCE(v_of_name, 'Nom OF manquant') || E'\n' || 'Pôle : ' || COALESCE(v_pole_nom, '—') || E'\n\n' || 'Merci de prendre en charge le dossier sous 24h.',
    'normale', 'a_faire', (now() + interval '1 day'), v_creator, v_assignee, NEW.pole_id, NEW.client_id, NEW.id, true, 'nouveau_dossier'
  ) RETURNING id INTO v_task_id;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT r.user_id, 'statut_change'::public.notification_type, 'Nouveau dossier dans votre pôle', NEW.titre, '/admin/dossiers/' || NEW.id
  FROM public.team_notification_recipients_for_pole(NEW.pole_id, NEW.client_id) r;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (v_creator, 'auto_task_created', 'dossier', NEW.id, CASE WHEN v_no_member THEN 'warning' ELSE 'info' END,
    jsonb_build_object('task_id', v_task_id, 'task_type', 'nouveau_dossier', 'assigned_to', v_assignee, 'pole_id', NEW.pole_id, 'pole_nom', v_pole_nom, 'no_pole_member', v_no_member, 'dossier_titre', NEW.titre, 'organisme_nom', v_of_name));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (NEW.client_id, 'message'::public.notification_type, 'Nouveau message de l''agence', LEFT(COALESCE(NEW.content,'Pièce jointe'),140), '/messages');
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id, 'message'::public.notification_type, 'Nouveau message client', LEFT(COALESCE(NEW.content,'Pièce jointe'),140), '/admin/messages/' || NEW.client_id
    FROM public.team_notification_recipients_for_client(NEW.client_id, NEW.sender_id) r;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_new_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_client uuid;
  v_pole_id uuid;
BEGIN
  SELECT client_id, pole_id INTO v_client, v_pole_id FROM public.dossiers WHERE id = NEW.dossier_id;
  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (v_client,
      CASE WHEN NEW.storage_path IS NULL AND COALESCE(NEW.statut::text, '') = 'en_attente' THEN 'document_demande'::public.notification_type ELSE 'document_depose'::public.notification_type END,
      CASE WHEN NEW.storage_path IS NULL AND COALESCE(NEW.statut::text, '') = 'en_attente' THEN 'Document demandé par l''agence' ELSE 'Nouveau document de l''agence' END,
      NEW.nom, '/dossiers/' || NEW.dossier_id);
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id, 'document_depose'::public.notification_type, 'Document à vérifier', NEW.nom, '/admin/dossiers/' || NEW.dossier_id
    FROM public.team_notification_recipients_for_pole(v_pole_id, NEW.uploader_id) r;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_rdv_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  d_str text := to_char(NEW.starts_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY à HH24"h"MI');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'en_attente' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      SELECT r.user_id, 'rdv'::public.notification_type, 'Nouvelle demande de rendez-vous', 'Créneau demandé le ' || d_str, '/admin/rendez-vous'
      FROM public.team_notification_recipients_for_client(NEW.client_id, NEW.client_id) r;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirme' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link) VALUES (NEW.client_id, 'rdv'::public.notification_type, 'Rendez-vous accepté', 'Votre rendez-vous du ' || d_str || ' est confirmé.', '/rendez-vous');
    ELSIF NEW.status = 'refuse' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link) VALUES (NEW.client_id, 'rdv'::public.notification_type, 'Rendez-vous refusé', 'Votre demande du ' || d_str || ' a été refusée. Merci de choisir un autre créneau.', '/rendez-vous');
    ELSIF NEW.status = 'annule' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link) VALUES (NEW.client_id, 'rdv'::public.notification_type, 'Rendez-vous annulé', 'Votre rendez-vous du ' || d_str || ' a été annulé.', '/rendez-vous');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_agency_task_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  action_str text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'terminee' AND NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT DISTINCT target.user_id, 'agency_task'::public.notification_type,
      CASE WHEN target.user_id = NEW.assigned_to THEN 'Nouvelle tâche assignée' ELSE 'Nouvelle tâche dans votre pôle' END,
      NEW.title,
      CASE WHEN NEW.dossier_id IS NOT NULL THEN '/admin/dossiers/' || NEW.dossier_id ELSE '/admin/taches-agence' END
    FROM (
      SELECT NEW.assigned_to AS user_id WHERE NEW.assigned_to IS NOT NULL AND NEW.assigned_to <> COALESCE(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
      UNION
      SELECT r.user_id FROM public.team_notification_recipients_for_pole(NEW.pole_id, COALESCE(NEW.created_by, auth.uid())) r
    ) target
    WHERE target.user_id IS NOT NULL;

    INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'agency_task.created', 'agency_task', NEW.id, 'info', jsonb_build_object('title', NEW.title, 'priority', NEW.priority, 'assigned_to', NEW.assigned_to));
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'terminee' AND OLD.status IS DISTINCT FROM 'terminee' THEN NEW.completed_at := now(); END IF;
    IF NEW.status <> 'terminee' AND OLD.status = 'terminee' THEN NEW.completed_at := NULL; END IF;
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      SELECT DISTINCT target.user_id, 'agency_task'::public.notification_type,
        CASE WHEN target.user_id = NEW.assigned_to THEN 'Tâche réassignée' ELSE 'Tâche mise à jour dans votre pôle' END,
        NEW.title,
        CASE WHEN NEW.dossier_id IS NOT NULL THEN '/admin/dossiers/' || NEW.dossier_id ELSE '/admin/taches-agence' END
      FROM (
        SELECT NEW.assigned_to AS user_id WHERE NEW.assigned_to <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
        UNION
        SELECT r.user_id FROM public.team_notification_recipients_for_pole(NEW.pole_id, auth.uid()) r
      ) target
      WHERE target.user_id IS NOT NULL;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      action_str := CASE WHEN NEW.status = 'terminee' THEN 'agency_task.completed' ELSE 'agency_task.status_changed' END;
      INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (auth.uid(), action_str, 'agency_task', NEW.id, 'info', jsonb_build_object('old', OLD.status, 'new', NEW.status));
    END IF;
    IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata) VALUES (auth.uid(), 'agency_task.archived', 'agency_task', NEW.id, 'info', '{}'::jsonb);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.test_push_notification_for_user(uuid);
DROP FUNCTION IF EXISTS public.test_push_notification_for_pole(uuid);

CREATE OR REPLACE FUNCTION public.test_push_notification_for_user(_user_id uuid)
RETURNS TABLE(notification_id uuid, user_id uuid, push_subscriptions_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_notification_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'direction'::public.app_role)) THEN
    RAISE EXCEPTION 'Réservé à la direction / administration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE ur.user_id = _user_id AND ur.role IN ('admin'::public.app_role, 'direction'::public.app_role, 'manager'::public.app_role, 'consultant'::public.app_role) AND pr.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Membre équipe introuvable ou désactivé';
  END IF;
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  VALUES (_user_id, 'alerte_securite'::public.notification_type, 'Test notifications IZISuivis', 'Test équipe : cloche interne et push navigateur si activé sur ce compte.', '/notifications')
  RETURNING id INTO v_notification_id;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'push.test_sent', 'user', _user_id, 'info', jsonb_build_object('notification_id', v_notification_id));
  RETURN QUERY SELECT v_notification_id, _user_id, COALESCE((SELECT count(*)::integer FROM public.push_subscriptions ps WHERE ps.user_id = _user_id), 0);
END;
$$;
REVOKE ALL ON FUNCTION public.test_push_notification_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.test_push_notification_for_user(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.test_push_notification_for_pole(_pole_id uuid)
RETURNS TABLE(notification_id uuid, user_id uuid, push_subscriptions_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pole_name text;
  v_count integer;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'direction'::public.app_role)) THEN
    RAISE EXCEPTION 'Réservé à la direction / administration';
  END IF;
  SELECT nom INTO v_pole_name FROM public.poles WHERE id = _pole_id AND actif = true;
  IF v_pole_name IS NULL THEN RAISE EXCEPTION 'Pôle introuvable ou inactif'; END IF;
  SELECT count(*) INTO v_count FROM public.team_notification_recipients_for_pole(_pole_id, NULL);
  IF v_count = 0 THEN RAISE EXCEPTION 'Aucun membre actif trouvé pour ce pôle'; END IF;

  RETURN QUERY
  WITH inserted AS (
    INSERT INTO public.notifications AS n (user_id, type, titre, message, link)
    SELECT r.user_id, 'alerte_securite'::public.notification_type, 'Test notifications pôle ' || v_pole_name, 'Test équipe : cloche interne pour chaque membre ciblé, push navigateur pour les appareils activés.', '/notifications'
    FROM public.team_notification_recipients_for_pole(_pole_id, NULL) r
    RETURNING n.id AS inserted_notification_id, n.user_id AS inserted_user_id
  )
  SELECT i.inserted_notification_id, i.inserted_user_id, COALESCE((SELECT count(*)::integer FROM public.push_subscriptions ps WHERE ps.user_id = i.inserted_user_id), 0)
  FROM inserted i;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'push.test_pole_sent', 'pole', _pole_id, 'info', jsonb_build_object('pole_nom', v_pole_name, 'recipients', v_count));
END;
$$;
REVOKE ALL ON FUNCTION public.test_push_notification_for_pole(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.test_push_notification_for_pole(uuid) TO authenticated, service_role;