
-- ============ conversations ============
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titre TEXT NOT NULL,
  parent_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conversations_parent_idx ON public.conversations(parent_id);
CREATE INDEX conversations_created_by_idx ON public.conversations(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;

-- ============ conversation_members ============
CREATE TABLE public.conversation_members (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON public.conversation_members(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_members TO authenticated;
GRANT ALL ON public.conversation_members TO service_role;

-- ============ group_messages ============
CREATE TABLE public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  content TEXT,
  attachment_path TEXT,
  attachment_name TEXT,
  attachment_mime TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  edited_by UUID,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID
);
CREATE INDEX group_messages_conv_idx ON public.group_messages(conversation_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_messages TO authenticated;
GRANT ALL ON public.group_messages TO service_role;

-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.is_conversation_member(_user_id UUID, _conv_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = _conv_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_owner(_user_id UUID, _conv_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = _conv_id AND user_id = _user_id AND role = 'owner'
  );
$$;

-- ============ RLS ============
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

-- conversations
CREATE POLICY "conv_select_members_or_admin"
ON public.conversations FOR SELECT TO authenticated
USING (
  public.is_conversation_member(auth.uid(), id)
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'direction')
);

CREATE POLICY "conv_insert_any_auth"
ON public.conversations FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());

CREATE POLICY "conv_update_owner_or_admin"
ON public.conversations FOR UPDATE TO authenticated
USING (
  public.is_conversation_owner(auth.uid(), id)
  OR public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  public.is_conversation_owner(auth.uid(), id)
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "conv_delete_owner_or_admin"
ON public.conversations FOR DELETE TO authenticated
USING (
  public.is_conversation_owner(auth.uid(), id)
  OR public.has_role(auth.uid(), 'admin')
);

-- conversation_members
CREATE POLICY "cm_select_if_member_or_admin"
ON public.conversation_members FOR SELECT TO authenticated
USING (
  public.is_conversation_member(auth.uid(), conversation_id)
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'direction')
);

CREATE POLICY "cm_insert_owner_or_admin_or_self_first"
ON public.conversation_members FOR INSERT TO authenticated
WITH CHECK (
  public.is_conversation_owner(auth.uid(), conversation_id)
  OR public.has_role(auth.uid(), 'admin')
  OR (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.created_by = auth.uid()
  ))
);

CREATE POLICY "cm_delete_owner_or_admin_or_self"
ON public.conversation_members FOR DELETE TO authenticated
USING (
  public.is_conversation_owner(auth.uid(), conversation_id)
  OR public.has_role(auth.uid(), 'admin')
  OR user_id = auth.uid()
);

-- group_messages
CREATE POLICY "gm_select_members_or_admin"
ON public.group_messages FOR SELECT TO authenticated
USING (
  public.is_conversation_member(auth.uid(), conversation_id)
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "gm_insert_members"
ON public.group_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_conversation_member(auth.uid(), conversation_id)
);

CREATE POLICY "gm_update_author_or_admin"
ON public.group_messages FOR UPDATE TO authenticated
USING (sender_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (sender_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "gm_delete_author_or_admin"
ON public.group_messages FOR DELETE TO authenticated
USING (sender_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ============ notifications trigger ============
CREATE OR REPLACE FUNCTION public.notify_new_group_message()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  conv_title TEXT;
BEGIN
  SELECT titre INTO conv_title FROM public.conversations WHERE id = NEW.conversation_id;
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT cm.user_id, 'message', 'Nouveau message dans '||COALESCE(conv_title,'un groupe'),
         LEFT(COALESCE(NEW.content,'Pièce jointe'), 140),
         '/messages/groupes/'||NEW.conversation_id
  FROM public.conversation_members cm
  WHERE cm.conversation_id = NEW.conversation_id
    AND cm.user_id <> NEW.sender_id;

  UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_notify_new_group_message
AFTER INSERT ON public.group_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_new_group_message();
