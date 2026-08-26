UPDATE public.agency_tasks
SET title = regexp_replace(title, '^Nouveau dossier à traiter —\s*', '')
WHERE task_type = 'nouveau_dossier'
  AND title LIKE 'Nouveau dossier à traiter —%';