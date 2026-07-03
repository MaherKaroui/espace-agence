
REVOKE EXECUTE ON FUNCTION public.rgpd_purge_old_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rgpd_purge_old_logs() TO postgres, service_role;
