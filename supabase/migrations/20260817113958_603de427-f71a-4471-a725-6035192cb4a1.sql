CREATE OR REPLACE FUNCTION public.notify_task_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t RECORD;
BEGIN
  SELECT * INTO t FROM public.agency_tasks WHERE id = NEW.task_id;
  IF t IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  VALUES (NEW.user_id, 'agency_task'::public.notification_type,
          'IZISUIVI – Nouvelle tâche assignée', t.title, '/admin/taches-agence');
  RETURN NEW;
END;
$$;

UPDATE public.agency_tasks t
SET assigned_to = a.user_id
FROM (
  SELECT DISTINCT ON (dossier_id) dossier_id, user_id
  FROM public.dossier_assignments
  WHERE role = 'juridique' AND active = true
  ORDER BY dossier_id, assigned_at DESC
) a
WHERE t.dossier_id = a.dossier_id
  AND t.task_type = 'nouveau_dossier'
  AND (t.assigned_to IS DISTINCT FROM a.user_id);

INSERT INTO public.agency_task_assignees (task_id, user_id)
SELECT t.id, t.assigned_to
FROM public.agency_tasks t
JOIN public.dossier_assignments d
  ON d.dossier_id = t.dossier_id AND d.role = 'juridique' AND d.active = true AND d.user_id = t.assigned_to
WHERE t.task_type = 'nouveau_dossier' AND t.assigned_to IS NOT NULL
ON CONFLICT DO NOTHING;