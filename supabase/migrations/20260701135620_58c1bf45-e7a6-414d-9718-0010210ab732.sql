
-- 1. security_settings: restrict SELECT to admin/direction
DROP POLICY IF EXISTS "Authenticated can read security settings" ON public.security_settings;
CREATE POLICY "Admin/Direction can read security settings"
  ON public.security_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));

-- 2. user_roles: explicit INSERT/UPDATE/DELETE policies restricted to admin/direction
DROP POLICY IF EXISTS "user_roles_insert_admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_update_admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_delete_admin" ON public.user_roles;
CREATE POLICY "user_roles_insert_admin" ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));
CREATE POLICY "user_roles_update_admin" ON public.user_roles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));
CREATE POLICY "user_roles_delete_admin" ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));

-- 3. Storage chat-files INSERT: require conversation membership (or dossier ownership as agence client) or admin
DROP POLICY IF EXISTS "chat_bucket_insert" ON storage.objects;
CREATE POLICY "chat_bucket_insert" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-files'
    AND (storage.foldername(name))[1] = (auth.uid())::text
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'direction')
      OR EXISTS (
        SELECT 1 FROM public.conversation_members cm
        WHERE cm.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.dossiers d WHERE d.client_id = auth.uid()
      )
    )
  );

-- 4. Fix search_path on functions missing it
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;

-- 5. Lock down SECURITY DEFINER functions - revoke public/anon EXECUTE
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- Grant EXECUTE to authenticated only on functions clients legitimately call
GRANT EXECUTE ON FUNCTION public.session_start(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_start(text, text, text, text, text, text, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_end(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_document_download(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_event(text, text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pole_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_message_content(text) TO authenticated;

-- service_role keeps full access for edge functions / admin
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
