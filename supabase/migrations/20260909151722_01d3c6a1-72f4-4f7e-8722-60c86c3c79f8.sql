
-- Helpers
CREATE OR REPLACE FUNCTION public.izi_admin_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.profiles WHERE lower(email) = 'admin@izi-business.com' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.person_label(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(btrim(COALESCE(p.prenom,'')||' '||COALESCE(p.nom,'')),''), p.email, 'Un utilisateur')
  FROM public.profiles p WHERE p.id = _user
$$;

-- Tâches : notifications admin (création / terminée)
CREATE OR REPLACE FUNCTION public.on_agency_task_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  action_str text;
  admin_id uuid;
  actor uuid;
BEGIN
  admin_id := public.izi_admin_user_id();
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'terminee' AND NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
    actor := COALESCE(NEW.created_by, auth.uid());
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

    IF admin_id IS NOT NULL AND admin_id IS DISTINCT FROM actor THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (admin_id, 'agency_task'::public.notification_type,
        'Nouvelle tâche : ' || NEW.title,
        'Créée par ' || COALESCE(public.person_label(actor), 'un utilisateur'),
        CASE WHEN NEW.dossier_id IS NOT NULL THEN '/admin/dossiers/' || NEW.dossier_id ELSE '/admin/taches-agence' END);
    END IF;

    INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'agency_task.created', 'agency_task', NEW.id, 'info', jsonb_build_object('title', NEW.title, 'priority', NEW.priority, 'assigned_to', NEW.assigned_to));
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    actor := COALESCE(auth.uid(), NEW.created_by);
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

      IF NEW.status = 'terminee' AND OLD.status IS DISTINCT FROM 'terminee'
         AND admin_id IS NOT NULL AND admin_id IS DISTINCT FROM actor THEN
        INSERT INTO public.notifications (user_id, type, titre, message, link)
        VALUES (admin_id, 'agency_task'::public.notification_type,
          'Tâche terminée : ' || NEW.title,
          'Terminée par ' || COALESCE(public.person_label(actor), 'un utilisateur'),
          CASE WHEN NEW.dossier_id IS NOT NULL THEN '/admin/dossiers/' || NEW.dossier_id ELSE '/admin/taches-agence' END);
      END IF;
    END IF;
    IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata) VALUES (auth.uid(), 'agency_task.archived', 'agency_task', NEW.id, 'info', '{}'::jsonb);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;

-- Commentaires de tâche : notification admin
CREATE OR REPLACE FUNCTION public.notify_agency_task_comment()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD;
  admin_id uuid;
BEGIN
  admin_id := public.izi_admin_user_id();
  IF admin_id IS NULL OR admin_id = NEW.user_id THEN RETURN NEW; END IF;
  SELECT * INTO t FROM public.agency_tasks WHERE id = NEW.task_id;
  IF t IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  VALUES (admin_id, 'agency_task'::public.notification_type,
    'Commentaire sur : ' || t.title,
    COALESCE(public.person_label(NEW.user_id), 'Un utilisateur') || ' : ' || LEFT(COALESCE(NEW.content, ''), 140),
    CASE WHEN t.dossier_id IS NOT NULL THEN '/admin/dossiers/' || t.dossier_id ELSE '/admin/taches-agence' END);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_agency_task_comment ON public.agency_task_comments;
CREATE TRIGGER trg_notify_agency_task_comment
AFTER INSERT ON public.agency_task_comments
FOR EACH ROW EXECUTE FUNCTION public.notify_agency_task_comment();

-- Messages : nom de l'expéditeur dans le titre
CREATE OR REPLACE FUNCTION public.notify_new_message()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE sender_name text;
BEGIN
  sender_name := COALESCE(public.person_label(NEW.sender_id), 'Un utilisateur');
  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (NEW.client_id, 'message'::public.notification_type, 'Message de ' || sender_name, LEFT(COALESCE(NEW.content,'Pièce jointe'),140), '/messages');
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id, 'message'::public.notification_type, 'Message de ' || sender_name, LEFT(COALESCE(NEW.content,'Pièce jointe'),140), '/admin/messages/' || NEW.client_id
    FROM public.team_notification_recipients_for_client(NEW.client_id, NEW.sender_id) r;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_new_group_message()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  conv_title TEXT;
  sender_name TEXT;
BEGIN
  SELECT titre INTO conv_title FROM public.conversations WHERE id = NEW.conversation_id;
  sender_name := COALESCE(public.person_label(NEW.sender_id), 'Un utilisateur');
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT cm.user_id, 'message', sender_name || ' – ' || COALESCE(conv_title,'groupe'),
         LEFT(COALESCE(NEW.content,'Pièce jointe'), 140),
         '/messages/groupes/'||NEW.conversation_id
  FROM public.conversation_members cm
  WHERE cm.conversation_id = NEW.conversation_id
    AND cm.user_id <> NEW.sender_id;

  UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.notify_new_internal_message()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  conv_title text;
  sender_name text;
BEGIN
  SELECT COALESCE(NULLIF(titre,''), 'Conversation interne') INTO conv_title
    FROM public.internal_conversations WHERE id = NEW.conversation_id;
  sender_name := COALESCE(public.person_label(NEW.sender_id), 'Un utilisateur');
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT m.user_id, 'internal_message',
         'Message interne de ' || sender_name,
         LEFT(COALESCE(NEW.content, 'Pièce jointe'), 140),
         '/admin/internal-messages/'||NEW.conversation_id
    FROM public.internal_conversation_members m
   WHERE m.conversation_id = NEW.conversation_id
     AND m.user_id <> NEW.sender_id;
  UPDATE public.internal_conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $function$;
