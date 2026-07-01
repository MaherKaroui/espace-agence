
-- 1. NOTIFICATION PREFERENCES
CREATE TABLE public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_prefs_own" ON public.notification_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE TRIGGER notif_prefs_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. ADMIN MESSAGE DELETION
ALTER TABLE public.messages
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by UUID REFERENCES auth.users(id);

CREATE TABLE public.message_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_message_id UUID NOT NULL,
  deleted_by UUID NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  original_author_id UUID NOT NULL,
  client_id UUID NOT NULL,
  content_hash TEXT NOT NULL,
  content_length INT
);
GRANT SELECT ON public.message_deletion_log TO authenticated;
GRANT ALL ON public.message_deletion_log TO service_role;
ALTER TABLE public.message_deletion_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mdl_read_admin" ON public.message_deletion_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));

DROP POLICY IF EXISTS "messages_update_admin_delete" ON public.messages;
CREATE POLICY "messages_update_admin_delete" ON public.messages
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.on_message_soft_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Seul un administrateur peut supprimer un message';
    END IF;
    INSERT INTO public.message_deletion_log
      (deleted_message_id, deleted_by, deleted_at, original_author_id, client_id, content_hash, content_length)
    VALUES
      (OLD.id, auth.uid(), now(), OLD.sender_id, OLD.client_id,
       encode(digest(COALESCE(OLD.content,''), 'sha256'), 'hex'),
       COALESCE(length(OLD.content), 0));
    NEW.content := NULL;
    NEW.attachment_path := NULL;
    NEW.attachment_name := NULL;
    NEW.attachment_mime := NULL;
    NEW.deleted_by := auth.uid();
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'message.deleted', 'message', OLD.id, 'warning',
      jsonb_build_object('client_id', OLD.client_id, 'original_author_id', OLD.sender_id));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_messages_soft_delete ON public.messages;
CREATE TRIGGER trg_messages_soft_delete
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.on_message_soft_delete();

-- 3. DOCUMENTS video fields
ALTER TABLE public.documents
  ADD COLUMN duration_seconds INT,
  ADD COLUMN thumbnail_path TEXT;

-- Ensure pgcrypto for digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
