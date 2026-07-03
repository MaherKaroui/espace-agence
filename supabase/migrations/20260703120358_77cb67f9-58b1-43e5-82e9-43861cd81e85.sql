
-- =====================================================================
-- 1) messages: prevent clients from changing anything but read_at
--    Fixes: messages_update_read_no_check + messages_from_agence_spoof
-- =====================================================================
CREATE OR REPLACE FUNCTION public.enforce_message_client_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  -- Non-admin (including staff): only read_at may change.
  NEW.sender_id       := OLD.sender_id;
  NEW.client_id       := OLD.client_id;
  NEW.from_agence     := OLD.from_agence;
  NEW.content         := OLD.content;
  NEW.attachment_path := OLD.attachment_path;
  NEW.attachment_name := OLD.attachment_name;
  NEW.attachment_mime := OLD.attachment_mime;
  NEW.deleted_at      := OLD.deleted_at;
  NEW.deleted_by      := OLD.deleted_by;
  NEW.edited_at       := OLD.edited_at;
  NEW.edited_by       := OLD.edited_by;
  NEW.created_at      := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_message_client_update ON public.messages;
CREATE TRIGGER trg_enforce_message_client_update
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_message_client_update();

-- Tighten policy WITH CHECK as belt-and-suspenders.
DROP POLICY IF EXISTS messages_update_read ON public.messages;
CREATE POLICY messages_update_read ON public.messages
FOR UPDATE
USING (client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- =====================================================================
-- 2) group_messages: run sanitize filter on UPDATE too
--    Fixes: group_msg_edit_filter_bypass
-- =====================================================================
CREATE OR REPLACE FUNCTION public.on_group_message_update_security()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE res RECORD;
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content AND NEW.content IS NOT NULL THEN
    SELECT * INTO res FROM public.sanitize_message_content(NEW.content);
    NEW.content := res.sanitized;
    IF res.flagged THEN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (auth.uid(), 'group_message.flagged', 'group_message', NEW.id, 'warning',
        jsonb_build_object('reasons', res.reasons, 'conversation_id', NEW.conversation_id, 'on_edit', true));
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      SELECT ur.user_id, 'alerte_securite',
        'Message de groupe modifié signalé (mots-clés interdits)',
        'Un message édité contient des termes filtrés : ' || array_to_string(res.reasons, ', '),
        '/messages/groupes/' || NEW.conversation_id
      FROM public.user_roles ur WHERE ur.role IN ('admin','direction');
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_group_message_update_security ON public.group_messages;
CREATE TRIGGER trg_group_message_update_security
BEFORE UPDATE ON public.group_messages
FOR EACH ROW EXECUTE FUNCTION public.on_group_message_update_security();

-- =====================================================================
-- 3) dossiers: force pole_id from categorie code on client inserts
--    Fixes: dossiers_insert_client_pole_bypass
-- =====================================================================
CREATE OR REPLACE FUNCTION public.enforce_dossier_client_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mapped_pole uuid;
BEGIN
  -- Staff/admin/direction may pick any active pole freely.
  IF public.has_role(auth.uid(), 'admin'::public.app_role)
     OR public.has_role(auth.uid(), 'direction'::public.app_role)
     OR public.is_pole_member(auth.uid(), NEW.pole_id) THEN
    RETURN NEW;
  END IF;

  -- Client insert: derive pole_id from the categorie code.
  SELECT id INTO mapped_pole
    FROM public.poles
   WHERE actif = true AND lower(code) = lower(NEW.categorie::text)
   LIMIT 1;

  IF mapped_pole IS NULL THEN
    RAISE EXCEPTION 'Aucun pôle actif ne correspond à la catégorie %', NEW.categorie;
  END IF;

  NEW.pole_id := mapped_pole;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_dossier_client_insert ON public.dossiers;
CREATE TRIGGER trg_enforce_dossier_client_insert
BEFORE INSERT ON public.dossiers
FOR EACH ROW EXECUTE FUNCTION public.enforce_dossier_client_insert();

-- =====================================================================
-- 4) storage: allow staff pole members to upload to documents bucket
--    Fixes: documents_bucket_insert_staff_missing
-- =====================================================================
CREATE POLICY documents_bucket_insert_staff_pole
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND EXISTS (
    SELECT 1
      FROM public.dossiers d
      JOIN public.pole_members pm ON pm.pole_id = d.pole_id
     WHERE (d.id)::text = (storage.foldername(objects.name))[1]
       AND pm.user_id = auth.uid()
  )
);

-- =====================================================================
-- 5) Revoke EXECUTE from anon/authenticated on SECURITY DEFINER functions
--    Fixes: SUPA_anon_security_definer_function_executable
--           SUPA_authenticated_security_definer_function_executable
-- Broad revoke; then re-grant only where users/service actually invoke.
-- =====================================================================
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
                   fn.nspname, fn.proname, fn.args);
  END LOOP;
END $$;

-- RLS helper functions (called inside policy expressions evaluated as authenticated)
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pole_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_view_client(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_conversation(uuid, uuid) TO authenticated;

-- User-callable RPCs from the app
GRANT EXECUTE ON FUNCTION public.session_start(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_start(text, text, text, text, text, text, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_end(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_document_download(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_event(text, text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generer_rapport_quotidien(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user_account(uuid) TO authenticated;

-- Service-role callers (email queue, admin ops)
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_queue_dispatch() TO service_role;
GRANT EXECUTE ON FUNCTION public.email_queue_wake() TO service_role;
GRANT EXECUTE ON FUNCTION public.rgpd_purge_old_logs() TO service_role;
GRANT EXECUTE ON FUNCTION public.close_stale_sessions() TO service_role;
GRANT EXECUTE ON FUNCTION public.send_rdv_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION public.generer_rapport_quotidien(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.sanitize_message_content(text) TO service_role;
