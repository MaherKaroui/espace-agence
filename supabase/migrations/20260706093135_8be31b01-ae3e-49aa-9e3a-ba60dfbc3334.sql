
CREATE POLICY "internal_chat_files_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'internal-chat-files'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_internal_member(auth.uid(), (split_part(name, '/', 1))::uuid)
    )
  );

CREATE POLICY "internal_chat_files_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'internal-chat-files'
    AND public.is_internal_member(auth.uid(), (split_part(name, '/', 1))::uuid)
  );

CREATE POLICY "internal_chat_files_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'internal-chat-files'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR owner = auth.uid()
    )
  );
