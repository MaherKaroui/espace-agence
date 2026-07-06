
-- 1) audit_logs: require user_id = auth.uid() on INSERT
DROP POLICY IF EXISTS "Users can insert their own audit rows" ON public.audit_logs;
CREATE POLICY "Users can insert their own audit rows"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 2) chat-files SELECT: require message/conversation membership, not just folder ownership
DROP POLICY IF EXISTS chat_bucket_select ON storage.objects;
CREATE POLICY chat_bucket_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-files'
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'direction'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.attachment_path = objects.name
          AND (
            m.client_id = auth.uid()
            OR m.sender_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.dossiers d
              WHERE d.client_id = m.client_id
                AND public.is_pole_member(auth.uid(), d.pole_id)
            )
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.group_messages gm
        WHERE gm.attachment_path = objects.name
          AND (
            gm.sender_id = auth.uid()
            OR public.is_conversation_member(auth.uid(), gm.conversation_id)
          )
      )
    )
  );

-- 3) dossiers UPDATE: tighten policy with WITH CHECK (defense in depth on top of trigger)
DROP POLICY IF EXISTS dossiers_update ON public.dossiers;
CREATE POLICY dossiers_update
  ON public.dossiers
  FOR UPDATE
  TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- 4) Revoke EXECUTE on trigger/cron/admin SECURITY DEFINER functions from authenticated + PUBLIC.
--    Keep executable: helpers used by RLS policies and app-called RPCs.
DO $$
DECLARE
  f text;
  internal_fns text[] := ARRAY[
    'recalc_dossier_from_taches()',
    'notify_new_deletion_request()',
    'notify_new_message()',
    'set_updated_at()',
    'notify_rdv_change()',
    'enforce_dossier_client_insert()',
    'on_tache_change()',
    'creer_taches_depuis_templates()',
    'enforce_message_client_update()',
    'auto_advance_dossier_from_documents()',
    'on_document_insert_audit()',
    'on_message_soft_delete()',
    'on_group_message_update_security()',
    'on_message_edit()',
    'on_message_insert_security()',
    'notify_dossier_status()',
    'notify_new_group_message()',
    'enforce_dossier_client_update()',
    'on_group_message_insert_security()',
    'notify_new_document()',
    'handle_new_user()',
    'email_queue_wake()',
    'email_queue_dispatch()',
    'rgpd_purge_old_logs()',
    'close_stale_sessions()',
    'send_rdv_reminders()',
    'generer_rapport_quotidien(date)',
    'anonymize_user_account(uuid)',
    'delete_email(text, bigint)',
    'read_email_batch(text, integer, integer)',
    'enqueue_email(text, jsonb)',
    'move_to_dlq(text, text, bigint, jsonb)'
  ];
BEGIN
  FOREACH f IN ARRAY internal_fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', f);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
