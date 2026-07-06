-- 1) Colonnes mentions + thread parent sur internal_messages
ALTER TABLE public.internal_messages
  ADD COLUMN IF NOT EXISTS mentions_users uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mentions_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS parent_message_id uuid REFERENCES public.internal_messages(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS internal_messages_parent_idx
  ON public.internal_messages (parent_message_id)
  WHERE parent_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS internal_messages_mentions_users_idx
  ON public.internal_messages USING gin (mentions_users);

-- 2) Table des réactions
CREATE TABLE IF NOT EXISTS public.internal_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.internal_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_message_reactions TO authenticated;
GRANT ALL ON public.internal_message_reactions TO service_role;

ALTER TABLE public.internal_message_reactions ENABLE ROW LEVEL SECURITY;

-- Voir les réactions si on peut voir la conversation du message
CREATE POLICY "reactions visible aux membres de la conv"
  ON public.internal_message_reactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.internal_messages m
      WHERE m.id = internal_message_reactions.message_id
        AND public.can_view_internal_conv(auth.uid(), m.conversation_id)
    )
  );

-- Chacun gère ses propres réactions (dans une conv qu'il peut voir)
CREATE POLICY "réagir dans une conv accessible"
  ON public.internal_message_reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.internal_messages m
      WHERE m.id = internal_message_reactions.message_id
        AND public.can_view_internal_conv(auth.uid(), m.conversation_id)
    )
  );

CREATE POLICY "retirer sa propre réaction"
  ON public.internal_message_reactions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- 3) Extension du type de notification
DO $$ BEGIN
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'internal_mention';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) Trigger de notification pour les mentions
CREATE OR REPLACE FUNCTION public.notify_internal_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mentioned uuid;
  sender_name text;
  conv_title text;
BEGIN
  IF NEW.mentions_users IS NULL OR array_length(NEW.mentions_users, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(CONCAT(p.prenom, ' ', p.nom)), ''), p.email, 'Un membre')
    INTO sender_name FROM public.profiles p WHERE p.id = NEW.sender_id;

  SELECT COALESCE(NULLIF(c.titre, ''), 'Conversation interne')
    INTO conv_title FROM public.internal_conversations c WHERE c.id = NEW.conversation_id;

  FOREACH mentioned IN ARRAY NEW.mentions_users LOOP
    IF mentioned = NEW.sender_id THEN CONTINUE; END IF;
    -- Ne pas notifier les membres qui ont mute cette conv
    IF EXISTS (
      SELECT 1 FROM public.internal_conversation_members m
      WHERE m.conversation_id = NEW.conversation_id
        AND m.user_id = mentioned
        AND m.muted = true
    ) THEN CONTINUE; END IF;

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (
      mentioned,
      'internal_mention',
      'Vous avez été mentionné·e',
      sender_name || ' vous a mentionné dans ' || conv_title,
      '/admin/internal-messages/' || NEW.conversation_id::text
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_internal_mentions ON public.internal_messages;
CREATE TRIGGER trg_notify_internal_mentions
  AFTER INSERT ON public.internal_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_internal_mentions();