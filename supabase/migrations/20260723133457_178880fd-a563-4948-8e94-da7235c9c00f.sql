REVOKE ALL ON FUNCTION public.notify_team_document_reminder(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_team_document_reminder(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.notify_team_dossier_reminder(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_team_dossier_reminder(uuid, text) TO service_role;