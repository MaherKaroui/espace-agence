DROP POLICY IF EXISTS "chat_bucket_select" ON storage.objects;

CREATE POLICY "chat_bucket_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-files'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'direction')
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.attachment_path = storage.objects.name
        AND (
          m.client_id = auth.uid()
          OR m.sender_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
          OR public.has_role(auth.uid(), 'direction')
          OR EXISTS (
            SELECT 1
            FROM public.dossiers d
            WHERE d.client_id = m.client_id
              AND public.is_pole_member(auth.uid(), d.pole_id)
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.group_messages gm
      WHERE gm.attachment_path = storage.objects.name
        AND (
          gm.sender_id = auth.uid()
          OR public.is_conversation_member(auth.uid(), gm.conversation_id)
          OR public.has_role(auth.uid(), 'admin')
          OR public.has_role(auth.uid(), 'direction')
        )
    )
  )
);