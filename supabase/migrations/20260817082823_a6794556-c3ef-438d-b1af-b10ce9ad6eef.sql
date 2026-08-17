ALTER TABLE public.agency_tasks ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.agency_task_reminders_sent (
  task_id uuid NOT NULL REFERENCES public.agency_tasks(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, kind)
);
GRANT SELECT ON public.agency_task_reminders_sent TO authenticated;
GRANT ALL ON public.agency_task_reminders_sent TO service_role;
ALTER TABLE public.agency_task_reminders_sent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task reminders select" ON public.agency_task_reminders_sent;
CREATE POLICY "task reminders select" ON public.agency_task_reminders_sent
FOR SELECT TO authenticated
USING (public.can_view_agency_task(auth.uid(), task_id));

-- Stockage des pièces jointes de tâches : chemin = <task_id>/<fichier>
DROP POLICY IF EXISTS task_files_select ON storage.objects;
CREATE POLICY task_files_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'task-files'
  AND public.can_view_agency_task(auth.uid(), (split_part(name, '/', 1))::uuid)
);

DROP POLICY IF EXISTS task_files_insert ON storage.objects;
CREATE POLICY task_files_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'task-files'
  AND public.is_agency_member(auth.uid())
  AND public.can_view_agency_task(auth.uid(), (split_part(name, '/', 1))::uuid)
);

DROP POLICY IF EXISTS task_files_delete ON storage.objects;
CREATE POLICY task_files_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'task-files'
  AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
);