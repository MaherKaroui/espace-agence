
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_by UUID;

CREATE OR REPLACE FUNCTION public.on_message_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ignorer la suppression (gérée par on_message_soft_delete) et la lecture
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.content IS DISTINCT FROM OLD.content AND OLD.deleted_at IS NULL THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Seul un administrateur peut modifier un message';
    END IF;
    NEW.edited_at := now();
    NEW.edited_by := auth.uid();

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'message.edited', 'message', OLD.id, 'warning',
      jsonb_build_object(
        'client_id', OLD.client_id,
        'original_author_id', OLD.sender_id,
        'previous_length', COALESCE(length(OLD.content), 0),
        'new_length', COALESCE(length(NEW.content), 0),
        'previous_hash', encode(digest(COALESCE(OLD.content,''), 'sha256'), 'hex')
      ));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_message_edit ON public.messages;
CREATE TRIGGER trg_on_message_edit
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.on_message_edit();
