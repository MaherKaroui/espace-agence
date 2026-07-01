
CREATE POLICY "thumb_select_by_document" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'document-thumbnails'
    AND EXISTS (
      SELECT 1 FROM public.documents d
      JOIN public.dossiers dos ON dos.id = d.dossier_id
      WHERE d.thumbnail_path = storage.objects.name
        AND (
          public.has_role(auth.uid(), 'admin')
          OR public.has_role(auth.uid(), 'direction')
          OR dos.client_id = auth.uid()
          OR public.is_pole_member(auth.uid(), dos.pole_id)
        )
    )
  );

CREATE POLICY "thumb_insert_staff" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'document-thumbnails' AND public.is_staff(auth.uid()));

CREATE POLICY "thumb_update_staff" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'document-thumbnails' AND public.is_staff(auth.uid()))
  WITH CHECK (bucket_id = 'document-thumbnails' AND public.is_staff(auth.uid()));

CREATE POLICY "thumb_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'document-thumbnails' AND public.has_role(auth.uid(), 'admin'));
