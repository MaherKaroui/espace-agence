
CREATE OR REPLACE FUNCTION public.on_message_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
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
        'previous_content', OLD.content,
        'new_content', NEW.content,
        'previous_hash', encode(extensions.digest(COALESCE(OLD.content,''), 'sha256'), 'hex')
      ));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_message_soft_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Seul un administrateur peut supprimer un message';
    END IF;
    INSERT INTO public.message_deletion_log
      (deleted_message_id, deleted_by, deleted_at, original_author_id, client_id, content_hash, content_length)
    VALUES
      (OLD.id, auth.uid(), now(), OLD.sender_id, OLD.client_id,
       encode(extensions.digest(COALESCE(OLD.content,''), 'sha256'), 'hex'),
       COALESCE(length(OLD.content), 0));
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'message.deleted', 'message', OLD.id, 'warning',
      jsonb_build_object(
        'client_id', OLD.client_id,
        'original_author_id', OLD.sender_id,
        'deleted_content', OLD.content,
        'attachment_name', OLD.attachment_name
      ));
    NEW.content := NULL;
    NEW.attachment_path := NULL;
    NEW.attachment_name := NULL;
    NEW.attachment_mime := NULL;
    NEW.deleted_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;
