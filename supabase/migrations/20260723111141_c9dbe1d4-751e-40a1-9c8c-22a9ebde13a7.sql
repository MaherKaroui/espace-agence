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
  WHERE pm.pole_id = NEW.pole_id AND pm.role = 'manager'
  ORDER BY pm.created_at ASC
  LIMIT 1;

  IF v_assignee IS NULL THEN
    SELECT pm.user_id INTO v_assignee
    FROM public.pole_members pm
    WHERE pm.pole_id = NEW.pole_id AND pm.role = 'consultant'
    ORDER BY pm.created_at ASC
    LIMIT 1;
  END IF;

  v_no_member := v_assignee IS NULL;

  SELECT ur.user_id INTO v_creator
  FROM public.user_roles ur
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
  SELECT DISTINCT recipient_id, 'statut_change'::public.notification_type,
    'Nouveau dossier dans votre pôle',
    NEW.titre,
    '/dossiers/' || NEW.id
  FROM (
    SELECT pm.user_id AS recipient_id
    FROM public.pole_members pm
    WHERE pm.pole_id = NEW.pole_id
    UNION
    SELECT ur.user_id AS recipient_id
    FROM public.user_roles ur
    WHERE ur.role IN ('admin','direction')
  ) r
  WHERE recipient_id IS NOT NULL AND recipient_id <> NEW.client_id;

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

DROP TRIGGER IF EXISTS trg_auto_task_new_dossier ON public.dossiers;
CREATE TRIGGER trg_auto_task_new_dossier
AFTER INSERT ON public.dossiers
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_task_for_new_dossier();

CREATE OR REPLACE FUNCTION public.trg_notify_push_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url text := 'https://izisuivis.com/api/public/hooks/push-fanout';
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object('notification_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS notifications_push_fanout ON public.notifications;
CREATE TRIGGER notifications_push_fanout
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.trg_notify_push_fanout();

CREATE OR REPLACE FUNCTION public.backfill_missing_auto_dossier_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT d.*
    FROM public.dossiers d
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.agency_tasks t
      WHERE t.dossier_id = d.id AND t.task_type = 'nouveau_dossier'
    )
    ORDER BY d.created_at ASC
  LOOP
    PERFORM public.auto_create_task_for_new_dossier() FROM (SELECT r.*) AS new_row;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auto_create_task_for_new_dossier() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_notify_push_fanout() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_missing_auto_dossier_tasks() FROM PUBLIC, anon, authenticated;