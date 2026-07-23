
-- 1) Fix broken self-referential subquery in int_members_insert policy.
--    Original intent: allow the conversation creator to add the FIRST members
--    (i.e. when no members exist yet for this conversation).
DROP POLICY IF EXISTS int_members_insert ON public.internal_conversation_members;

CREATE POLICY int_members_insert
ON public.internal_conversation_members
FOR INSERT
TO authenticated
WITH CHECK (
  is_agency_member(user_id)
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR is_internal_owner(auth.uid(), conversation_id)
    OR (
      -- Bootstrap: creator of the conversation can add members
      -- while the membership table is still empty for that conversation.
      NOT EXISTS (
        SELECT 1
        FROM public.internal_conversation_members m
        WHERE m.conversation_id = internal_conversation_members.conversation_id
      )
      AND EXISTS (
        SELECT 1
        FROM public.internal_conversations c
        WHERE c.id = internal_conversation_members.conversation_id
          AND c.created_by = auth.uid()
      )
    )
    OR (
      is_internal_owner(auth.uid(), conversation_id)
      AND can_internal_contact(auth.uid(), user_id)
    )
  )
);

-- 2) Restrict task templates to staff roles (admin, direction, manager, consultant).
DROP POLICY IF EXISTS "Tous les connectés voient les templates" ON public.tache_templates;

CREATE POLICY "Staff voient les templates"
ON public.tache_templates
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'direction'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'consultant'::app_role)
);

-- 3) Defensive topic-scoped policies on realtime.messages.
--    The app currently uses only public channels, so these policies do not
--    change today's behavior. They ensure that if a future feature switches
--    to private Broadcast/Presence channels, only legit subscribers can join.
--    Denies everything else by default (RLS = default deny).
DROP POLICY IF EXISTS "izisuivis: authenticated read own notif topic" ON realtime.messages;
DROP POLICY IF EXISTS "izisuivis: authenticated write own notif topic" ON realtime.messages;

CREATE POLICY "izisuivis: authenticated read own notif topic"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- notif-<uid>-...  and  notif-toast-<uid>-...
  realtime.topic() LIKE ('notif-' || auth.uid()::text || '-%')
  OR realtime.topic() LIKE ('notif-toast-' || auth.uid()::text || '-%')
);

CREATE POLICY "izisuivis: authenticated write own notif topic"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() LIKE ('notif-' || auth.uid()::text || '-%')
  OR realtime.topic() LIKE ('notif-toast-' || auth.uid()::text || '-%')
);
