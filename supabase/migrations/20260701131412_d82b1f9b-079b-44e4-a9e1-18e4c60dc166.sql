
CREATE TABLE public.group_message_reads (
  message_id uuid NOT NULL REFERENCES public.group_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX idx_group_message_reads_message ON public.group_message_reads(message_id);
CREATE INDEX idx_group_message_reads_user ON public.group_message_reads(user_id);

GRANT SELECT, INSERT ON public.group_message_reads TO authenticated;
GRANT ALL ON public.group_message_reads TO service_role;

ALTER TABLE public.group_message_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view reads of their conversations"
ON public.group_message_reads FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.group_messages gm
    WHERE gm.id = group_message_reads.message_id
      AND public.is_conversation_member(auth.uid(), gm.conversation_id)
  )
);

CREATE POLICY "Users can insert their own reads"
ON public.group_message_reads FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.group_messages gm
    WHERE gm.id = message_id
      AND public.is_conversation_member(auth.uid(), gm.conversation_id)
  )
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_message_reads;
