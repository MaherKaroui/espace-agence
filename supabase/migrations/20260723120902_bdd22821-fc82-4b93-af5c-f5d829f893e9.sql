REVOKE EXECUTE ON FUNCTION public.team_notification_recipients_for_pole(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.team_notification_recipients_for_client(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.team_notification_recipients_for_pole(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_notification_recipients_for_client(uuid, uuid) TO service_role;