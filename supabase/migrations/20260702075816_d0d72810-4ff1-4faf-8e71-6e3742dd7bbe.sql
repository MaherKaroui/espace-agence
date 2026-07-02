CREATE OR REPLACE FUNCTION public.on_message_insert_security()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE res RECORD;
BEGIN
  IF NEW.content IS NOT NULL THEN
    SELECT * INTO res FROM public.sanitize_message_content(NEW.content);
    NEW.content := res.sanitized;
    IF res.flagged THEN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (NEW.sender_id, 'message.flagged', 'message', NEW.id, 'warning',
        jsonb_build_object('reasons', res.reasons, 'client_id', NEW.client_id));
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      SELECT ur.user_id, 'alerte_securite',
        'Message signalé (mots-clés interdits)',
        'Un message contient des termes filtrés : ' || array_to_string(res.reasons, ', '),
        '/admin/messages/' || NEW.client_id
      FROM public.user_roles ur WHERE ur.role IN ('admin','direction');
    END IF;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (NEW.sender_id, 'message.sent', 'message', NEW.id, 'info',
    jsonb_build_object('client_id', NEW.client_id, 'from_agence', NEW.from_agence, 'has_attachment', NEW.attachment_path IS NOT NULL));
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.on_group_message_insert_security()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE res RECORD;
BEGIN
  IF NEW.content IS NOT NULL THEN
    SELECT * INTO res FROM public.sanitize_message_content(NEW.content);
    NEW.content := res.sanitized;
    IF res.flagged THEN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (NEW.sender_id, 'group_message.flagged', 'group_message', NEW.id, 'warning',
        jsonb_build_object('reasons', res.reasons, 'conversation_id', NEW.conversation_id));
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      SELECT ur.user_id, 'alerte_securite',
        'Message de groupe signalé (mots-clés interdits)',
        'Un message contient des termes filtrés : ' || array_to_string(res.reasons, ', '),
        '/messages/groupes/' || NEW.conversation_id
      FROM public.user_roles ur WHERE ur.role IN ('admin','direction');
    END IF;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (NEW.sender_id, 'group_message.sent', 'group_message', NEW.id, 'info',
    jsonb_build_object('conversation_id', NEW.conversation_id, 'has_attachment', NEW.attachment_path IS NOT NULL));
  RETURN NEW;
END; $$;