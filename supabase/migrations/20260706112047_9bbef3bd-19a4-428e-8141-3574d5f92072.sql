-- 1) Nouvelles colonnes conversations
ALTER TABLE public.internal_conversations
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS pole_id uuid REFERENCES public.poles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.agency_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.internal_conversations
    ADD CONSTRAINT internal_conversations_type_check
    CHECK (type IN ('direct','pole','client','dossier','task','custom'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS internal_conversations_pole_unique
  ON public.internal_conversations(pole_id) WHERE type = 'pole' AND pole_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS internal_conversations_client_unique
  ON public.internal_conversations(client_id) WHERE type = 'client' AND client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS internal_conversations_dossier_unique
  ON public.internal_conversations(dossier_id) WHERE type = 'dossier' AND dossier_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS internal_conversations_task_unique
  ON public.internal_conversations(task_id) WHERE type = 'task' AND task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS internal_conversations_pole_idx ON public.internal_conversations(pole_id);
CREATE INDEX IF NOT EXISTS internal_conversations_client_idx ON public.internal_conversations(client_id);
CREATE INDEX IF NOT EXISTS internal_conversations_dossier_idx ON public.internal_conversations(dossier_id);
CREATE INDEX IF NOT EXISTS internal_conversations_task_idx ON public.internal_conversations(task_id);

-- 2) Nouvelles colonnes membres
ALTER TABLE public.internal_conversation_members
  ADD COLUMN IF NOT EXISTS favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false;

-- 3) Fonction de visibilité étendue (admin, direction, membres explicites, membres du pôle)
CREATE OR REPLACE FUNCTION public.can_view_internal_conv(_user uuid, _conv uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_user, 'admin'::app_role)
    OR public.has_role(_user, 'direction'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.internal_conversation_members
       WHERE conversation_id = _conv AND user_id = _user
    )
    OR EXISTS (
      SELECT 1 FROM public.internal_conversations c
       WHERE c.id = _conv
         AND c.type = 'pole'
         AND c.pole_id IS NOT NULL
         AND public.is_pole_member(_user, c.pole_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_post_internal_conv(_user uuid, _conv uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_internal_conv(_user, _conv);
$$;

-- 4) RLS SELECT : élargir aux personnes autorisées (admin/direction/pôle)
DROP POLICY IF EXISTS int_conv_select_members ON public.internal_conversations;
CREATE POLICY int_conv_select_visible ON public.internal_conversations
  FOR SELECT TO authenticated
  USING (public.can_view_internal_conv(auth.uid(), id));

DROP POLICY IF EXISTS int_msg_select ON public.internal_messages;
CREATE POLICY int_msg_select ON public.internal_messages
  FOR SELECT TO authenticated
  USING (public.can_view_internal_conv(auth.uid(), conversation_id));

DROP POLICY IF EXISTS int_members_select ON public.internal_conversation_members;
CREATE POLICY int_members_select ON public.internal_conversation_members
  FOR SELECT TO authenticated
  USING (public.can_view_internal_conv(auth.uid(), conversation_id));

-- 5) RLS INSERT messages : autoriser l'admin/direction/membre-de-pôle à poster
DROP POLICY IF EXISTS int_msg_insert ON public.internal_messages;
CREATE POLICY int_msg_insert ON public.internal_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.can_post_internal_conv(auth.uid(), conversation_id)
  );

-- 6) RLS UPDATE membres : chacun peut mettre à jour ses propres flags (last_read_at, favorite, muted)
DROP POLICY IF EXISTS int_members_update_last_read ON public.internal_conversation_members;
CREATE POLICY int_members_update_self ON public.internal_conversation_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_internal_owner(auth.uid(), conversation_id) OR public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (user_id = auth.uid() OR public.is_internal_owner(auth.uid(), conversation_id) OR public.has_role(auth.uid(),'admin'::app_role));
