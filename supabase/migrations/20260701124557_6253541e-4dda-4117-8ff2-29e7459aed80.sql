
CREATE OR REPLACE FUNCTION public.on_group_message_insert_security()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE res RECORD;
BEGIN
  IF NEW.content IS NOT NULL THEN
    SELECT * INTO res FROM public.sanitize_message_content(NEW.content);
    NEW.content := res.sanitized;
    IF res.flagged THEN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (NEW.sender_id, 'group_message.flagged', 'group_message', NEW.id, 'warning',
        jsonb_build_object('reasons', res.reasons, 'conversation_id', NEW.conversation_id));
    END IF;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (NEW.sender_id, 'group_message.sent', 'group_message', NEW.id, 'info',
    jsonb_build_object('conversation_id', NEW.conversation_id, 'has_attachment', NEW.attachment_path IS NOT NULL));
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_group_message_insert_security ON public.group_messages;
CREATE TRIGGER trg_group_message_insert_security
  BEFORE INSERT ON public.group_messages
  FOR EACH ROW EXECUTE FUNCTION public.on_group_message_insert_security();
