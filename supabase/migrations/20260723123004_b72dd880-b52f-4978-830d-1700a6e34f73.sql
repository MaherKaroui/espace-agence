-- 1) Push subscriptions: allow several devices per user, and make upsert safe per user/device.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND conname = 'push_subscriptions_endpoint_key'
  ) THEN
    ALTER TABLE public.push_subscriptions DROP CONSTRAINT push_subscriptions_endpoint_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_endpoint_key
  ON public.push_subscriptions (user_id, endpoint);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

-- 2) Central recipient helpers: active pole members + active admin/direction.
CREATE OR REPLACE FUNCTION public.team_notification_recipients_for_pole(
  _pole_id uuid,
  _exclude_user_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT r.user_id
  FROM (
    SELECT pm.user_id
    FROM public.pole_members pm
    JOIN public.profiles pr ON pr.id = pm.user_id
    JOIN public.user_roles ur ON ur.user_id = pm.user_id
    WHERE _pole_id IS NOT NULL
      AND pm.pole_id = _pole_id
      AND pr.archived_at IS NULL
      AND ur.role IN ('manager'::public.app_role, 'consultant'::public.app_role, 'admin'::public.app_role, 'direction'::public.app_role)

    UNION

    SELECT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
      AND pr.archived_at IS NULL
  ) r
  WHERE r.user_id IS NOT NULL
    AND (_exclude_user_id IS NULL OR r.user_id <> _exclude_user_id);
$$;

CREATE OR REPLACE FUNCTION public.team_notification_recipients_for_client(
  _client_id uuid,
  _exclude_user_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT r.user_id
  FROM (
    SELECT pm.user_id
    FROM public.dossiers d
    JOIN public.pole_members pm ON pm.pole_id = d.pole_id
    JOIN public.profiles pr ON pr.id = pm.user_id
    JOIN public.user_roles ur ON ur.user_id = pm.user_id
    WHERE d.client_id = _client_id
      AND pr.archived_at IS NULL
      AND ur.role IN ('manager'::public.app_role, 'consultant'::public.app_role, 'admin'::public.app_role, 'direction'::public.app_role)

    UNION

    SELECT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
      AND pr.archived_at IS NULL
  ) r
  WHERE r.user_id IS NOT NULL
    AND r.user_id <> _client_id
    AND (_exclude_user_id IS NULL OR r.user_id <> _exclude_user_id);
$$;

REVOKE ALL ON FUNCTION public.team_notification_recipients_for_pole(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_notification_recipients_for_client(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_notification_recipients_for_pole(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_notification_recipients_for_client(uuid, uuid) TO service_role;

-- 3) Notifications creation for all relevant team events.
CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (
      NEW.client_id,
      'message'::public.notification_type,
      'Nouveau message de l''agence',
      LEFT(COALESCE(NEW.content,'Pièce jointe'),140),
      '/messages'
    );
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id,
      'message'::public.notification_type,
      'Nouveau message client',
      LEFT(COALESCE(NEW.content,'Pièce jointe'),140),
      '/admin/messages/' || NEW.client_id
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
  SELECT client_id, pole_id INTO v_client, v_pole_id
  FROM public.dossiers
  WHERE id = NEW.dossier_id;

  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (
      v_client,
      CASE WHEN NEW.storage_path IS NULL AND COALESCE(NEW.statut::text, '') = 'en_attente'
        THEN 'document_demande'::public.notification_type
        ELSE 'document_depose'::public.notification_type
      END,
      CASE WHEN NEW.storage_path IS NULL AND COALESCE(NEW.statut::text, '') = 'en_attente'
        THEN 'Document demandé par l''agence'
        ELSE 'Nouveau document de l''agence'
      END,
      NEW.nom,
      '/dossiers/' || NEW.dossier_id
    );
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id,
      'document_depose'::public.notification_type,
      'Document à vérifier',
      NEW.nom,
      '/dossiers/' || NEW.dossier_id
    FROM public.team_notification_recipients_for_pole(v_pole_id, NEW.uploader_id) r;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_dossier_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  statut_label text;
BEGIN
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    statut_label := CASE NEW.statut::text
      WHEN 'en_attente' THEN 'En attente'
      WHEN 'documents_manquants' THEN 'Documents manquants'
      WHEN 'en_cours_etude' THEN 'En cours d''étude'
      WHEN 'en_cours_traitement' THEN 'En cours de traitement'
      WHEN 'a_completer' THEN 'À compléter'
      WHEN 'valide' THEN 'Validé'
      WHEN 'refuse' THEN 'Refusé'
      WHEN 'termine' THEN 'Terminé'
      WHEN 'annule' THEN 'Annulé'
      ELSE NEW.statut::text
    END;

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (
      NEW.client_id,
      'statut_change'::public.notification_type,
      'Statut du dossier mis à jour',
      NEW.titre || ' : ' || statut_label,
      '/dossiers/' || NEW.id
    );

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id,
      'statut_change'::public.notification_type,
      'Dossier modifié',
      NEW.titre || ' : ' || statut_label,
      '/dossiers/' || NEW.id
    FROM public.team_notification_recipients_for_pole(NEW.pole_id, auth.uid()) r;
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
      SELECT r.user_id,
        'rdv'::public.notification_type,
        'Nouvelle demande de rendez-vous',
        'Créneau demandé le ' || d_str,
        '/admin/rendez-vous'
      FROM public.team_notification_recipients_for_client(NEW.client_id, NEW.client_id) r;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirme' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.client_id, 'rdv'::public.notification_type, 'Rendez-vous accepté',
        'Votre rendez-vous du ' || d_str || ' est confirmé.', '/rendez-vous');
    ELSIF NEW.status = 'refuse' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.client_id, 'rdv'::public.notification_type, 'Rendez-vous refusé',
        'Votre demande du ' || d_str || ' a été refusée. Merci de choisir un autre créneau.', '/rendez-vous');
    ELSIF NEW.status = 'annule' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.client_id, 'rdv'::public.notification_type, 'Rendez-vous annulé',
        'Votre rendez-vous du ' || d_str || ' a été annulé.', '/rendez-vous');
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
    IF NEW.status = 'terminee' AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;

    IF NEW.assigned_to IS NOT NULL
       AND NEW.assigned_to <> COALESCE(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.assigned_to, 'agency_task'::public.notification_type,
        'Nouvelle tâche assignée', NEW.title, '/admin/taches-agence');
    END IF;

    INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'agency_task.created', 'agency_task', NEW.id, 'info',
      jsonb_build_object('title', NEW.title, 'priority', NEW.priority, 'assigned_to', NEW.assigned_to));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'terminee' AND OLD.status IS DISTINCT FROM 'terminee' THEN
      NEW.completed_at := now();
    END IF;
    IF NEW.status <> 'terminee' AND OLD.status = 'terminee' THEN
      NEW.completed_at := NULL;
    END IF;

    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       AND NEW.assigned_to IS NOT NULL
       AND NEW.assigned_to <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.assigned_to, 'agency_task'::public.notification_type,
        'Tâche réassignée', NEW.title, '/admin/taches-agence');
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      action_str := CASE WHEN NEW.status = 'terminee' THEN 'agency_task.completed' ELSE 'agency_task.status_changed' END;
      INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (auth.uid(), action_str, 'agency_task', NEW.id, 'info',
        jsonb_build_object('old', OLD.status, 'new', NEW.status));
    END IF;

    IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (auth.uid(), 'agency_task.archived', 'agency_task', NEW.id, 'info', '{}'::jsonb);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

-- 4) Manual test helper: creates a real internal notification, so the existing push fan-out trigger runs.
CREATE OR REPLACE FUNCTION public.test_push_notification_for_user(_user_id uuid)
RETURNS uuid
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
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE ur.user_id = _user_id
      AND ur.role IN ('admin'::public.app_role, 'direction'::public.app_role, 'manager'::public.app_role, 'consultant'::public.app_role)
      AND pr.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Membre équipe introuvable ou désactivé';
  END IF;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  VALUES (
    _user_id,
    'alerte'::public.notification_type,
    'Test notifications IZISuivis',
    'Si le push navigateur est actif, cette notification doit aussi apparaître sur le PC.',
    '/notifications'
  )
  RETURNING id INTO v_notification_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'push.test_sent', 'user', _user_id, 'info', jsonb_build_object('notification_id', v_notification_id));

  RETURN v_notification_id;
END;
$$;

REVOKE ALL ON FUNCTION public.test_push_notification_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.test_push_notification_for_user(uuid) TO authenticated, service_role;