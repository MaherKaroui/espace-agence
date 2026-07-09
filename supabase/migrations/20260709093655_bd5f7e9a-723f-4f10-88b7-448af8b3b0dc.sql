
-- =========================================================
-- MODE ÉPHÉMÈRE — colonnes conversations + messages
-- =========================================================

-- 1) Conversations (groupes publics)
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ephemeral_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ephemeral_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS ephemeral_members_can_edit boolean NOT NULL DEFAULT false;

-- 2) Internal conversations
ALTER TABLE public.internal_conversations
  ADD COLUMN IF NOT EXISTS ephemeral_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ephemeral_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS ephemeral_members_can_edit boolean NOT NULL DEFAULT false;

-- 3) Messages tables : expires_at + is_system
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

ALTER TABLE public.internal_messages
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS messages_expires_at_idx
  ON public.messages (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS group_messages_expires_at_idx
  ON public.group_messages (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS internal_messages_expires_at_idx
  ON public.internal_messages (expires_at) WHERE expires_at IS NOT NULL;

-- =========================================================
-- 4) Réglages éphémères pour la conversation client ↔ agence
-- =========================================================
CREATE TABLE IF NOT EXISTS public.client_ephemeral_settings (
  client_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ephemeral_enabled boolean NOT NULL DEFAULT false,
  ephemeral_duration_seconds integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_ephemeral_settings TO authenticated;
GRANT ALL ON public.client_ephemeral_settings TO service_role;

ALTER TABLE public.client_ephemeral_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ces_select" ON public.client_ephemeral_settings;
CREATE POLICY "ces_select" ON public.client_ephemeral_settings
  FOR SELECT TO authenticated
  USING (
    client_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR public.client_in_scope(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "ces_write" ON public.client_ephemeral_settings;
CREATE POLICY "ces_write" ON public.client_ephemeral_settings
  FOR ALL TO authenticated
  USING (
    client_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR public.client_in_scope(auth.uid(), client_id)
  )
  WITH CHECK (
    client_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR public.client_in_scope(auth.uid(), client_id)
  );

CREATE TRIGGER trg_ces_updated_at
  BEFORE UPDATE ON public.client_ephemeral_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 5) Triggers set expires_at
-- =========================================================

-- messages (client ↔ agence)
CREATE OR REPLACE FUNCTION public.set_expires_at_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  IF NEW.is_system THEN RETURN NEW; END IF;
  IF NEW.expires_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT ephemeral_enabled, ephemeral_duration_seconds INTO s
    FROM public.client_ephemeral_settings WHERE client_id = NEW.client_id;
  IF s.ephemeral_enabled AND s.ephemeral_duration_seconds > 0 THEN
    NEW.expires_at := now() + make_interval(secs => s.ephemeral_duration_seconds);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_set_expires_at ON public.messages;
CREATE TRIGGER trg_messages_set_expires_at
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_expires_at_messages();

-- group_messages
CREATE OR REPLACE FUNCTION public.set_expires_at_group_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  IF NEW.is_system THEN RETURN NEW; END IF;
  IF NEW.expires_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT ephemeral_enabled, ephemeral_duration_seconds INTO s
    FROM public.conversations WHERE id = NEW.conversation_id;
  IF s.ephemeral_enabled AND s.ephemeral_duration_seconds > 0 THEN
    NEW.expires_at := now() + make_interval(secs => s.ephemeral_duration_seconds);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_messages_set_expires_at ON public.group_messages;
CREATE TRIGGER trg_group_messages_set_expires_at
  BEFORE INSERT ON public.group_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_expires_at_group_messages();

-- internal_messages
CREATE OR REPLACE FUNCTION public.set_expires_at_internal_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  IF NEW.is_system THEN RETURN NEW; END IF;
  IF NEW.expires_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT ephemeral_enabled, ephemeral_duration_seconds INTO s
    FROM public.internal_conversations WHERE id = NEW.conversation_id;
  IF s.ephemeral_enabled AND s.ephemeral_duration_seconds > 0 THEN
    NEW.expires_at := now() + make_interval(secs => s.ephemeral_duration_seconds);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_internal_messages_set_expires_at ON public.internal_messages;
CREATE TRIGGER trg_internal_messages_set_expires_at
  BEFORE INSERT ON public.internal_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_expires_at_internal_messages();

-- =========================================================
-- 6) Autorisation d'édition du mode éphémère sur les groupes
-- =========================================================

-- conversations (groupes publics) : ajout d'une policy UPDATE dédiée quand
-- l'option ephemeral_members_can_edit est activée. On garde la policy
-- existante conv_update_owner_or_admin pour les owners et admins.
DROP POLICY IF EXISTS "conv_update_members_ephemeral" ON public.conversations;
CREATE POLICY "conv_update_members_ephemeral" ON public.conversations
  FOR UPDATE TO authenticated
  USING (
    ephemeral_members_can_edit = true
    AND public.is_conversation_member(auth.uid(), id)
  )
  WITH CHECK (
    public.is_conversation_member(auth.uid(), id)
  );

-- internal_conversations : la policy UPDATE existante autorise déjà owner/admin.
-- On ajoute une policy pour les membres quand ephemeral_members_can_edit=true.
DROP POLICY IF EXISTS "int_conv_update_members_ephemeral" ON public.internal_conversations;
CREATE POLICY "int_conv_update_members_ephemeral" ON public.internal_conversations
  FOR UPDATE TO authenticated
  USING (
    ephemeral_members_can_edit = true
    AND public.is_internal_member(auth.uid(), id)
  )
  WITH CHECK (
    public.is_internal_member(auth.uid(), id)
  );

-- =========================================================
-- 7) Fonction de purge (retourne les rows à supprimer)
--    Le service role fera le hard delete + suppression storage.
-- =========================================================
CREATE OR REPLACE FUNCTION public.list_expired_ephemeral(_limit int DEFAULT 500)
RETURNS TABLE (
  source text,
  id uuid,
  attachment_path text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  (SELECT 'messages'::text, id, attachment_path FROM public.messages
    WHERE expires_at IS NOT NULL AND expires_at < now() LIMIT _limit)
  UNION ALL
  (SELECT 'group_messages'::text, id, attachment_path FROM public.group_messages
    WHERE expires_at IS NOT NULL AND expires_at < now() LIMIT _limit)
  UNION ALL
  (SELECT 'internal_messages'::text, id, attachment_path FROM public.internal_messages
    WHERE expires_at IS NOT NULL AND expires_at < now() LIMIT _limit);
$$;

REVOKE ALL ON FUNCTION public.list_expired_ephemeral(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_expired_ephemeral(int) TO service_role;
