
CREATE OR REPLACE FUNCTION public.on_internal_message_insert_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (NEW.sender_id, 'internal_message.sent', 'internal_message', NEW.id, 'info',
    jsonb_build_object('conversation_id', NEW.conversation_id, 'has_attachment', NEW.attachment_path IS NOT NULL));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_internal_message_audit ON public.internal_messages;
CREATE TRIGGER trg_internal_message_audit AFTER INSERT ON public.internal_messages
  FOR EACH ROW EXECUTE FUNCTION public.on_internal_message_insert_audit();
