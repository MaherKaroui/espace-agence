
CREATE POLICY "documents_bucket_select" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documents' AND (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id::text = (storage.foldername(name))[1] AND d.client_id = auth.uid()
    )
  )
);
CREATE POLICY "documents_bucket_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id::text = (storage.foldername(name))[1] AND d.client_id = auth.uid()
    )
  )
);
CREATE POLICY "documents_bucket_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'documents' AND (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id::text = (storage.foldername(name))[1] AND d.client_id = auth.uid()
    )
  )
);

CREATE POLICY "chat_bucket_select" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-files' AND (
    public.has_role(auth.uid(),'admin')
    OR (storage.foldername(name))[1] = auth.uid()::text
  )
);
CREATE POLICY "chat_bucket_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-files' AND (
    public.has_role(auth.uid(),'admin')
    OR (storage.foldername(name))[1] = auth.uid()::text
  )
);
