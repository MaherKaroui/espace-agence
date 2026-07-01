
-- 1. Fix search_path on set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- 2. Revoke EXECUTE from PUBLIC / anon / authenticated on all SECURITY DEFINER functions,
--    then grant back only where actually needed by RLS or client RPC calls.
--    Trigger functions do NOT need EXECUTE grants at runtime (permission checked at trigger creation).

REVOKE EXECUTE ON FUNCTION public.creer_taches_depuis_templates() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_tache_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_dossier_from_taches() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_document_insert_audit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_message_insert_security() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_dossier_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_new_document() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_new_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sanitize_message_content(text) FROM PUBLIC, anon, authenticated;

-- RLS-helper functions: keep executable by authenticated only
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_pole_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pole_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;

-- Client RPC functions: authenticated only
REVOKE EXECUTE ON FUNCTION public.log_document_download(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_event(text,text,uuid,text,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generer_rapport_quotidien(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_document_download(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_event(text,text,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generer_rapport_quotidien(date) TO authenticated;

-- 3. Chat-files bucket: add DELETE and UPDATE policies (admin or uploader by folder)
CREATE POLICY "chat_bucket_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-files'
  AND (public.has_role(auth.uid(), 'admin') OR (storage.foldername(name))[1] = auth.uid()::text)
);

CREATE POLICY "chat_bucket_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'chat-files'
  AND (public.has_role(auth.uid(), 'admin') OR (storage.foldername(name))[1] = auth.uid()::text)
)
WITH CHECK (
  bucket_id = 'chat-files'
  AND (public.has_role(auth.uid(), 'admin') OR (storage.foldername(name))[1] = auth.uid()::text)
);

-- 4. Documents bucket: explicit UPDATE restricted to admin (blocks arbitrary overwrite)
CREATE POLICY "documents_bucket_update_admin" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'documents' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'documents' AND public.has_role(auth.uid(), 'admin'));

-- 5. Staff pole members can read documents of dossiers in their poles (table + storage)
CREATE POLICY "documents_select_staff_pole" ON public.documents
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.dossiers d
    JOIN public.pole_members pm ON pm.pole_id = d.pole_id
    WHERE d.id = documents.dossier_id AND pm.user_id = auth.uid()
  )
);

CREATE POLICY "documents_bucket_select_staff_pole" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'documents'
  AND EXISTS (
    SELECT 1 FROM public.dossiers d
    JOIN public.pole_members pm ON pm.pole_id = d.pole_id
    WHERE d.id::text = (storage.foldername(name))[1]
      AND pm.user_id = auth.uid()
  )
);
