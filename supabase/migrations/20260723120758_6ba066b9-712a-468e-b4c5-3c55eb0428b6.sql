CREATE OR REPLACE FUNCTION public.team_notification_recipients_for_pole(
  _pole_id uuid,
  _exclude_user_id uuid DEFAULT NULL
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
    WHERE _pole_id IS NOT NULL
      AND pm.pole_id = _pole_id
      AND pr.archived_at IS NULL

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
  _exclude_user_id uuid DEFAULT NULL
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
    WHERE d.client_id = _client_id
      AND pr.archived_at IS NULL

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

REVOKE ALL ON FUNCTION public.team_notification_recipients_for_pole(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_notification_recipients_for_client(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_notification_recipients_for_pole(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_notification_recipients_for_client(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_create_task_for_new_dossier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  SELECT id INTO v_existing
  FROM public.agency_tasks
  WHERE dossier_id = NEW.id AND task_type = 'nouveau_dossier'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT pm.user_id INTO v_assignee
  FROM public.pole_members pm
  JOIN public.profiles pr ON pr.id = pm.user_id AND pr.archived_at IS NULL
  WHERE pm.pole_id = NEW.pole_id AND pm.role = 'manager'
  ORDER BY pm.created_at ASC
  LIMIT 1;

  IF v_assignee IS NULL THEN
    SELECT pm.user_id INTO v_assignee
    FROM public.pole_members pm
    JOIN public.profiles pr ON pr.id = pm.user_id AND pr.archived_at IS NULL
    WHERE pm.pole_id = NEW.pole_id AND pm.role = 'consultant'
    ORDER BY pm.created_at ASC
    LIMIT 1;
  END IF;

  v_no_member := v_assignee IS NULL;

  SELECT ur.user_id INTO v_creator
  FROM public.user_roles ur
  JOIN public.profiles pr ON pr.id = ur.user_id AND pr.archived_at IS NULL
  WHERE ur.role = 'admin'
  ORDER BY ur.id ASC
  LIMIT 1;

  IF v_creator IS NULL THEN
    v_creator := NEW.client_id;
  END IF;

  IF v_assignee IS NULL THEN
    v_assignee := v_creator;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.prenom, p.nom)), ''), p.email)
    INTO v_client_name
  FROM public.profiles p WHERE p.id = NEW.client_id;

  v_of_name := NULLIF(TRIM(NEW.organisme_nom), '');
  SELECT nom INTO v_pole_nom FROM public.poles WHERE id = NEW.pole_id;

  INSERT INTO public.agency_tasks (
    title, description, priority, status, due_date,
    created_by, assigned_to, pole_id, client_id, dossier_id,
    auto, task_type
  ) VALUES (
    'Nouveau dossier à traiter — ' || NEW.titre,
    'Client : ' || COALESCE(v_client_name, '—') || E'\n' ||
    'Organisme de formation : ' || COALESCE(v_of_name, 'Nom OF manquant') || E'\n' ||
    'Pôle : ' || COALESCE(v_pole_nom, '—') || E'\n\n' ||
    'Merci de prendre en charge le dossier sous 24h.',
    'normale',
    'a_faire',
    (now() + interval '1 day'),
    v_creator,
    v_assignee,
    NEW.pole_id,
    NEW.client_id,
    NEW.id,
    true,
    'nouveau_dossier'
  ) RETURNING id INTO v_task_id;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT r.user_id, 'statut_change'::public.notification_type,
    'Nouveau dossier dans votre pôle',
    NEW.titre,
    '/dossiers/' || NEW.id
  FROM public.team_notification_recipients_for_pole(NEW.pole_id, NEW.client_id) r;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (
    v_creator,
    'auto_task_created',
    'dossier',
    NEW.id,
    CASE WHEN v_no_member THEN 'warning' ELSE 'info' END,
    jsonb_build_object(
      'task_id', v_task_id,
      'task_type', 'nouveau_dossier',
      'assigned_to', v_assignee,
      'pole_id', NEW.pole_id,
      'pole_nom', v_pole_nom,
      'no_pole_member', v_no_member,
      'dossier_titre', NEW.titre,
      'organisme_nom', v_of_name
    )
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_auto_task_for_dossier(_dossier_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.dossiers%ROWTYPE;
  v_existing uuid;
  v_assignee uuid;
  v_creator uuid;
  v_client_name text;
  v_of_name text;
  v_task_id uuid;
  v_pole_nom text;
  v_no_member boolean;
BEGIN
  SELECT * INTO d FROM public.dossiers WHERE id = _dossier_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_existing
  FROM public.agency_tasks
  WHERE dossier_id = d.id AND task_type = 'nouveau_dossier'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT pm.user_id INTO v_assignee
  FROM public.pole_members pm
  JOIN public.profiles pr ON pr.id = pm.user_id AND pr.archived_at IS NULL
  WHERE pm.pole_id = d.pole_id AND pm.role = 'manager'
  ORDER BY pm.created_at ASC
  LIMIT 1;

  IF v_assignee IS NULL THEN
    SELECT pm.user_id INTO v_assignee
    FROM public.pole_members pm
    JOIN public.profiles pr ON pr.id = pm.user_id AND pr.archived_at IS NULL
    WHERE pm.pole_id = d.pole_id AND pm.role = 'consultant'
    ORDER BY pm.created_at ASC
    LIMIT 1;
  END IF;

  v_no_member := v_assignee IS NULL;

  SELECT ur.user_id INTO v_creator
  FROM public.user_roles ur
  JOIN public.profiles pr ON pr.id = ur.user_id AND pr.archived_at IS NULL
  WHERE ur.role = 'admin'
  ORDER BY ur.id ASC
  LIMIT 1;

  IF v_creator IS NULL THEN
    v_creator := d.client_id;
  END IF;

  IF v_assignee IS NULL THEN
    v_assignee := v_creator;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.prenom, p.nom)), ''), p.email)
    INTO v_client_name
  FROM public.profiles p WHERE p.id = d.client_id;

  v_of_name := NULLIF(TRIM(d.organisme_nom), '');
  SELECT nom INTO v_pole_nom FROM public.poles WHERE id = d.pole_id;

  INSERT INTO public.agency_tasks (
    title, description, priority, status, due_date,
    created_by, assigned_to, pole_id, client_id, dossier_id,
    auto, task_type
  ) VALUES (
    'Nouveau dossier à traiter — ' || d.titre,
    'Client : ' || COALESCE(v_client_name, '—') || E'\n' ||
    'Organisme de formation : ' || COALESCE(v_of_name, 'Nom OF manquant') || E'\n' ||
    'Pôle : ' || COALESCE(v_pole_nom, '—') || E'\n\n' ||
    'Merci de prendre en charge le dossier sous 24h.',
    'normale',
    'a_faire',
    (now() + interval '1 day'),
    v_creator,
    v_assignee,
    d.pole_id,
    d.client_id,
    d.id,
    true,
    'nouveau_dossier'
  ) RETURNING id INTO v_task_id;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT r.user_id, 'statut_change'::public.notification_type,
    'Nouveau dossier dans votre pôle',
    d.titre,
    '/dossiers/' || d.id
  FROM public.team_notification_recipients_for_pole(d.pole_id, d.client_id) r;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (
    v_creator,
    'auto_task_created',
    'dossier',
    d.id,
    CASE WHEN v_no_member THEN 'warning' ELSE 'info' END,
    jsonb_build_object(
      'task_id', v_task_id,
      'task_type', 'nouveau_dossier',
      'assigned_to', v_assignee,
      'pole_id', d.pole_id,
      'pole_nom', v_pole_nom,
      'no_pole_member', v_no_member,
      'dossier_titre', d.titre,
      'organisme_nom', v_of_name
    )
  );

  RETURN v_task_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_new_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client uuid;
  v_pole_id uuid;
BEGIN
  SELECT client_id, pole_id INTO v_client, v_pole_id FROM public.dossiers WHERE id = NEW.dossier_id;

  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (
      v_client,
      CASE WHEN NEW.storage_path IS NULL AND COALESCE(NEW.statut::text, '') = 'en_attente' THEN 'document_demande'::public.notification_type ELSE 'document_depose'::public.notification_type END,
      CASE WHEN NEW.storage_path IS NULL AND COALESCE(NEW.statut::text, '') = 'en_attente' THEN 'Document demandé par l''agence' ELSE 'Nouveau document de l''agence' END,
      NEW.nom,
      '/dossiers/'||NEW.dossier_id
    );
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id, 'document_depose'::public.notification_type,
      'Nouveau document déposé', NEW.nom, '/dossiers/'||NEW.dossier_id
    FROM public.team_notification_recipients_for_pole(v_pole_id, NEW.uploader_id) r;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (NEW.client_id, 'message', 'Nouveau message de l''agence', LEFT(COALESCE(NEW.content,'Pièce jointe'),140), '/messages');
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id, 'message'::public.notification_type,
      'Nouveau message client', LEFT(COALESCE(NEW.content,'Pièce jointe'),140), '/admin/messages/'||NEW.client_id
    FROM public.team_notification_recipients_for_client(NEW.client_id, NEW.sender_id) r;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_dossier_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  statut_label TEXT;
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
    VALUES (NEW.client_id, 'statut_change', 'Statut du dossier mis à jour',
      NEW.titre || ' : ' || statut_label, '/dossiers/' || NEW.id);

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id, 'statut_change'::public.notification_type,
      'Dossier modifié', NEW.titre || ' : ' || statut_label, '/dossiers/' || NEW.id
    FROM public.team_notification_recipients_for_pole(NEW.pole_id, auth.uid()) r;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_rdv_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d_str text := to_char(NEW.starts_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY à HH24"h"MI');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'en_attente' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      SELECT r.user_id, 'rdv'::public.notification_type,
        'Nouvelle demande de rendez-vous',
        'Créneau demandé le '||d_str,
        '/admin/rendez-vous'
      FROM public.team_notification_recipients_for_client(NEW.client_id, NEW.client_id) r;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirme' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.client_id, 'rdv', 'Rendez-vous accepté',
        'Votre rendez-vous du '||d_str||' est confirmé.', '/rendez-vous');
    ELSIF NEW.status = 'refuse' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.client_id, 'rdv', 'Rendez-vous refusé',
        'Votre demande du '||d_str||' a été refusée. Merci de choisir un autre créneau.', '/rendez-vous');
    ELSIF NEW.status = 'annule' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.client_id, 'rdv', 'Rendez-vous annulé',
        'Votre rendez-vous du '||d_str||' a été annulé.', '/rendez-vous');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_rdv_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  d_str text;
  titre_client text;
  titre_admin text;
BEGIN
  FOR r IN
    SELECT rv.* FROM public.rendez_vous rv
    WHERE rv.status = 'confirme'
      AND rv.starts_at BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
      AND NOT EXISTS (SELECT 1 FROM public.rdv_reminders_sent s WHERE s.rdv_id = rv.id AND s.kind = '24h')
  LOOP
    d_str := to_char(r.starts_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY à HH24"h"MI');
    titre_client := 'Rappel : rendez-vous demain';
    titre_admin  := 'Rappel : rendez-vous client demain';

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (r.client_id, 'rdv', titre_client,
      'Votre rendez-vous est prévu le ' || d_str || '.', '/rendez-vous');

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT tr.user_id, 'rdv', titre_admin,
      'Rendez-vous prévu le ' || d_str || '.', '/admin/rendez-vous'
    FROM public.team_notification_recipients_for_client(r.client_id, r.client_id) tr;

    INSERT INTO public.rdv_reminders_sent (rdv_id, kind) VALUES (r.id, '24h')
      ON CONFLICT DO NOTHING;
  END LOOP;

  FOR r IN
    SELECT rv.* FROM public.rendez_vous rv
    WHERE rv.status = 'confirme'
      AND rv.starts_at BETWEEN (now() + interval '50 minutes') AND (now() + interval '70 minutes')
      AND NOT EXISTS (SELECT 1 FROM public.rdv_reminders_sent s WHERE s.rdv_id = rv.id AND s.kind = '1h')
  LOOP
    d_str := to_char(r.starts_at AT TIME ZONE 'Europe/Paris', 'HH24"h"MI');
    titre_client := 'Rappel : rendez-vous dans 1 heure';
    titre_admin  := 'Rappel : rendez-vous client dans 1 heure';

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (r.client_id, 'rdv', titre_client,
      'Votre rendez-vous commence à ' || d_str || '.', '/rendez-vous');

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT tr.user_id, 'rdv', titre_admin,
      'Rendez-vous à ' || d_str || '.', '/admin/rendez-vous'
    FROM public.team_notification_recipients_for_client(r.client_id, r.client_id) tr;

    INSERT INTO public.rdv_reminders_sent (rdv_id, kind) VALUES (r.id, '1h')
      ON CONFLICT DO NOTHING;
  END LOOP;
END;
$function$;
