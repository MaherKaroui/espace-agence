-- Revoke EXECUTE from anon on SECURITY DEFINER helpers (all are staff-only)
REVOKE EXECUTE ON FUNCTION public.get_last_activity(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.enforce_role_exclusivity() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.enable_team_member(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.email_template_enabled(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_admin_email() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.disable_team_member(uuid, text) FROM anon, public;

-- Set fixed search_path on email queue helpers
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;