
-- Enums
CREATE TYPE public.agency_task_priority AS ENUM ('basse','normale','haute','urgente');
CREATE TYPE public.agency_task_status AS ENUM ('a_faire','en_cours','bloquee','terminee');

-- Add notification type value (function bodies are parsed lazily so we can reference it below)
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'agency_task';

-- Table
CREATE TABLE public.agency_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  priority public.agency_task_priority NOT NULL DEFAULT 'normale',
  status public.agency_task_status NOT NULL DEFAULT 'a_faire',
  due_date TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pole_id UUID REFERENCES public.poles(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  dossier_id UUID REFERENCES public.dossiers(id) ON DELETE SET NULL,
  attachment_path TEXT,
  attachment_name TEXT,
  internal_comment TEXT,
  completed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agency_tasks_assigned_status ON public.agency_tasks(assigned_to, status) WHERE archived_at IS NULL;
CREATE INDEX idx_agency_tasks_pole_status ON public.agency_tasks(pole_id, status) WHERE archived_at IS NULL;
CREATE INDEX idx_agency_tasks_due ON public.agency_tasks(due_date) WHERE archived_at IS NULL AND status <> 'terminee';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_tasks TO authenticated;
GRANT ALL ON public.agency_tasks TO service_role;

ALTER TABLE public.agency_tasks ENABLE ROW LEVEL SECURITY;

-- Helper: peut voir une tâche
CREATE OR REPLACE FUNCTION public.can_view_agency_task(_user UUID, _task_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agency_tasks t
    WHERE t.id = _task_id
      AND (
        public.has_role(_user, 'admin'::app_role)
        OR public.has_role(_user, 'direction'::app_role)
        OR t.assigned_to = _user
        OR t.created_by = _user
        OR (t.pole_id IS NOT NULL AND public.is_pole_member(_user, t.pole_id))
      )
  );
$$;

-- Policies agency_tasks
CREATE POLICY "agency_tasks_select"
ON public.agency_tasks FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'direction'::app_role)
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
  OR (pole_id IS NOT NULL AND public.is_pole_member(auth.uid(), pole_id))
);

CREATE POLICY "agency_tasks_insert"
ON public.agency_tasks FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR (pole_id IS NOT NULL AND public.is_pole_member(auth.uid(), pole_id))
  )
);

CREATE POLICY "agency_tasks_update"
ON public.agency_tasks FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'direction'::app_role)
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
  OR (pole_id IS NOT NULL AND public.is_pole_member(auth.uid(), pole_id))
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'direction'::app_role)
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
  OR (pole_id IS NOT NULL AND public.is_pole_member(auth.uid(), pole_id))
);

CREATE POLICY "agency_tasks_delete_admin"
ON public.agency_tasks FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'direction'::app_role));

-- Commentaires
CREATE TABLE public.agency_task_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.agency_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agency_task_comments_task ON public.agency_task_comments(task_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_task_comments TO authenticated;
GRANT ALL ON public.agency_task_comments TO service_role;

ALTER TABLE public.agency_task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_task_comments_select"
ON public.agency_task_comments FOR SELECT TO authenticated
USING (public.can_view_agency_task(auth.uid(), task_id));

CREATE POLICY "agency_task_comments_insert"
ON public.agency_task_comments FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.can_view_agency_task(auth.uid(), task_id));

CREATE POLICY "agency_task_comments_delete"
ON public.agency_task_comments FOR DELETE TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'direction'::app_role)
);

-- Trigger updated_at
CREATE TRIGGER agency_tasks_updated_at
BEFORE UPDATE ON public.agency_tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trigger: completed_at + audit + notifications
CREATE OR REPLACE FUNCTION public.on_agency_task_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  notify_user UUID;
  action_str TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'terminee' AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
    -- Notify assignee (differ from creator)
    IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to <> COALESCE(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.assigned_to, 'agency_task'::notification_type,
        'Nouvelle tâche assignée',
        NEW.title,
        '/admin/taches-agence');
    END IF;
    INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'agency_task.created', 'agency_task', NEW.id, 'info',
      jsonb_build_object('title', NEW.title, 'priority', NEW.priority, 'assigned_to', NEW.assigned_to));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Set completed_at on transition
    IF NEW.status = 'terminee' AND OLD.status IS DISTINCT FROM 'terminee' THEN
      NEW.completed_at := now();
    END IF;
    IF NEW.status <> 'terminee' AND OLD.status = 'terminee' THEN
      NEW.completed_at := NULL;
    END IF;

    -- Reassignment notification
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       AND NEW.assigned_to IS NOT NULL
       AND NEW.assigned_to <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.assigned_to, 'agency_task'::notification_type,
        'Tâche réassignée',
        NEW.title,
        '/admin/taches-agence');
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      action_str := CASE WHEN NEW.status = 'terminee' THEN 'agency_task.completed' ELSE 'agency_task.status_changed' END;
      INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (auth.uid(), action_str, 'agency_task', NEW.id, 'info',
        jsonb_build_object('old', OLD.status, 'new', NEW.status));
    END IF;

    IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
      INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (auth.uid(), 'agency_task.archived', 'agency_task', NEW.id, 'info', '{}'::jsonb);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER agency_tasks_change
BEFORE INSERT OR UPDATE ON public.agency_tasks
FOR EACH ROW EXECUTE FUNCTION public.on_agency_task_change();
