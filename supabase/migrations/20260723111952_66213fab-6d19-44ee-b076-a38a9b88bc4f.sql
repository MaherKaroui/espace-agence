CREATE OR REPLACE VIEW public.izisuivis_notification_task_health AS
SELECT
  (SELECT count(*) FROM public.dossiers) AS dossiers_total,
  (SELECT count(*) FROM public.dossiers d WHERE NOT EXISTS (
    SELECT 1 FROM public.agency_tasks t WHERE t.dossier_id = d.id AND t.task_type = 'nouveau_dossier'
  )) AS dossiers_without_auto_task,
  (SELECT count(*) FROM (
    SELECT dossier_id FROM public.agency_tasks WHERE task_type = 'nouveau_dossier' GROUP BY dossier_id HAVING count(*) > 1
  ) dup) AS auto_task_duplicate_dossiers,
  (SELECT count(*) FROM public.dossiers WHERE organisme_nom IS NULL OR trim(organisme_nom) = '') AS dossiers_missing_organisme_nom,
  (SELECT count(*) FROM public.push_subscriptions) AS push_subscriptions_total;

REVOKE ALL ON public.izisuivis_notification_task_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.izisuivis_notification_task_health TO service_role;