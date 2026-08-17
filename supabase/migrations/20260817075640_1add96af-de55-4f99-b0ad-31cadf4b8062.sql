
-- 1) Traçabilité dossiers
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE public.agency_tasks ADD COLUMN IF NOT EXISTS updated_by uuid;

CREATE OR REPLACE FUNCTION public.stamp_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
    NEW.updated_by := COALESCE(NEW.updated_by, auth.uid());
  ELSE
    NEW.updated_by := COALESCE(auth.uid(), OLD.updated_by);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stamp_actor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_actor_dossiers ON public.dossiers;
CREATE TRIGGER trg_stamp_actor_dossiers
BEFORE INSERT OR UPDATE ON public.dossiers
FOR EACH ROW EXECUTE FUNCTION public.stamp_actor();

CREATE OR REPLACE FUNCTION public.stamp_actor_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stamp_actor_task() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_actor_tasks ON public.agency_tasks;
CREATE TRIGGER trg_stamp_actor_tasks
BEFORE INSERT OR UPDATE ON public.agency_tasks
FOR EACH ROW EXECUTE FUNCTION public.stamp_actor_task();

-- 2) Libellés de statut enrichis (Planification / Audit réalisé)
CREATE OR REPLACE FUNCTION public.notify_dossier_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  statut_label text;
BEGIN
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    statut_label := CASE NEW.statut::text
      WHEN 'en_attente' THEN 'En attente'
      WHEN 'documents_manquants' THEN 'Documents manquants'
      WHEN 'en_cours_etude' THEN 'En cours d''étude'
      WHEN 'en_cours_traitement' THEN 'En cours de traitement'
      WHEN 'planification' THEN 'Planification'
      WHEN 'audit_realise' THEN 'Audit réalisé'
      WHEN 'a_completer' THEN 'À compléter'
      WHEN 'valide' THEN 'Validé'
      WHEN 'refuse' THEN 'Refusé'
      WHEN 'termine' THEN 'Dossier clôturé'
      WHEN 'annule' THEN 'Annulé'
      ELSE NEW.statut::text
    END;

    IF NEW.client_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (
        NEW.client_id,
        'statut_change'::public.notification_type,
        'IZISUIVI – ' || statut_label,
        NEW.titre || ' : ' || statut_label,
        '/dossiers/' || NEW.id
      );
    END IF;

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id,
      'statut_change'::public.notification_type,
      'IZISUIVI – ' || statut_label,
      NEW.titre || ' : ' || statut_label,
      '/dossiers/' || NEW.id
    FROM public.team_notification_recipients_for_pole(NEW.pole_id, auth.uid()) r;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) Ajout automatique au Calendrier Qualiopi en Planification
CREATE OR REPLACE FUNCTION public.dossier_to_qualiopi_calendar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_rdv date;
BEGIN
  IF NEW.statut::text = 'planification' AND (TG_OP = 'INSERT' OR NEW.statut IS DISTINCT FROM OLD.statut) THEN
    IF EXISTS (SELECT 1 FROM public.qualiopi_calendar_events e WHERE e.dossier_id = NEW.id) THEN
      RETURN NEW;
    END IF;
    SELECT (r.starts_at AT TIME ZONE 'Europe/Paris')::date INTO next_rdv
    FROM public.rendez_vous r
    WHERE r.dossier_id = NEW.id AND r.starts_at >= now()
    ORDER BY r.starts_at ASC LIMIT 1;

    INSERT INTO public.qualiopi_calendar_events
      (audit_date, organism_name, formation, auditor_user_id, status, observation, dossier_id, created_by, updated_by)
    VALUES (
      COALESCE(next_rdv, CURRENT_DATE),
      COALESCE(NULLIF(trim(NEW.organisme_nom), ''), NEW.titre),
      NEW.titre,
      NEW.responsable_id,
      'planifie'::public.qualiopi_event_status,
      'Ajouté automatiquement depuis le dossier (passage en Planification)',
      NEW.id,
      COALESCE(auth.uid(), NEW.created_by),
      COALESCE(auth.uid(), NEW.created_by)
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dossier_to_qualiopi_calendar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dossier_to_qualiopi_calendar ON public.dossiers;
CREATE TRIGGER trg_dossier_to_qualiopi_calendar
AFTER INSERT OR UPDATE OF statut ON public.dossiers
FOR EACH ROW EXECUTE FUNCTION public.dossier_to_qualiopi_calendar();

-- 4) Pièces jointes sur les tâches agence
CREATE TABLE IF NOT EXISTS public.agency_task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.agency_tasks(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime_type text,
  file_size bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.agency_task_attachments TO authenticated;
GRANT ALL ON public.agency_task_attachments TO service_role;
ALTER TABLE public.agency_task_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task attachments select" ON public.agency_task_attachments;
CREATE POLICY "task attachments select" ON public.agency_task_attachments
FOR SELECT TO authenticated
USING (public.can_view_agency_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "task attachments insert" ON public.agency_task_attachments;
CREATE POLICY "task attachments insert" ON public.agency_task_attachments
FOR INSERT TO authenticated
WITH CHECK (uploaded_by = auth.uid() AND public.can_view_agency_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "task attachments delete" ON public.agency_task_attachments;
CREATE POLICY "task attachments delete" ON public.agency_task_attachments
FOR DELETE TO authenticated
USING (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- 5) Assignation multiple sur les tâches agence
CREATE TABLE IF NOT EXISTS public.agency_task_assignees (
  task_id uuid NOT NULL REFERENCES public.agency_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  added_by uuid,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.agency_task_assignees TO authenticated;
GRANT ALL ON public.agency_task_assignees TO service_role;
ALTER TABLE public.agency_task_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task assignees select" ON public.agency_task_assignees;
CREATE POLICY "task assignees select" ON public.agency_task_assignees
FOR SELECT TO authenticated
USING (public.can_view_agency_task(auth.uid(), task_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS "task assignees write" ON public.agency_task_assignees;
CREATE POLICY "task assignees write" ON public.agency_task_assignees
FOR INSERT TO authenticated
WITH CHECK (public.is_agency_member(auth.uid()) AND public.can_view_agency_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "task assignees remove" ON public.agency_task_assignees;
CREATE POLICY "task assignees remove" ON public.agency_task_assignees
FOR DELETE TO authenticated
USING (public.is_agency_member(auth.uid()) AND public.can_view_agency_task(auth.uid(), task_id));

-- Notifier chaque personne assignée
CREATE OR REPLACE FUNCTION public.notify_task_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
BEGIN
  SELECT id, title INTO t FROM public.agency_tasks WHERE id = NEW.task_id;
  IF t.id IS NULL OR NEW.user_id = auth.uid() THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  VALUES (NEW.user_id, 'tache_assignee'::public.notification_type,
          'IZISUIVI – Nouvelle tâche assignée', t.title, '/admin/taches-agence');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_task_assignee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_task_assignee ON public.agency_task_assignees;
CREATE TRIGGER trg_notify_task_assignee
AFTER INSERT ON public.agency_task_assignees
FOR EACH ROW EXECUTE FUNCTION public.notify_task_assignee();
