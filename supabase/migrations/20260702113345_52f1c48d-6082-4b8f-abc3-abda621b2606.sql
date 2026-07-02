
-- =========================================================
-- 1) Revoke EXECUTE on SECURITY DEFINER trigger/internal functions
--    from PUBLIC / authenticated / anon. Keep only helpers used
--    in RLS or user-callable RPCs.
-- =========================================================
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'notify_new_group_message()',
    'notify_rdv_change()',
    'on_group_message_insert_security()',
    'on_message_edit()',
    'on_message_soft_delete()',
    'sanitize_message_content(text)',
    'email_queue_dispatch()',
    'email_queue_wake()',
    'enqueue_email(text,jsonb)',
    'delete_email(text,bigint)',
    'move_to_dlq(text,text,bigint,jsonb)',
    'read_email_batch(text,integer,integer)',
    'close_stale_sessions()',
    'generer_rapport_quotidien(date)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

-- =========================================================
-- 2) chat-files storage INSERT policy — bind to specific
--    conversation / 1:1 client, not just "any conversation".
--    New path scheme: {uploaderId}/{scope}/{uuid}-name
--      scope = 'dm-<clientId>'    for 1:1 (messages)
--      scope = 'conv-<convId>'    for groups (group_messages)
-- =========================================================
DROP POLICY IF EXISTS chat_bucket_insert ON storage.objects;

CREATE POLICY chat_bucket_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-files'
  AND (storage.foldername(name))[1] = (auth.uid())::text
  AND (
    -- admin/direction can always upload to their own folder
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'direction'::public.app_role)
    OR (
      -- Group chat: second segment "conv-<uuid>", must be member of that conversation
      (storage.foldername(name))[2] LIKE 'conv-%'
      AND public.is_conversation_member(
            auth.uid(),
            NULLIF(substring((storage.foldername(name))[2] from 6), '')::uuid
          )
    )
    OR (
      -- 1:1 chat: second segment "dm-<clientUuid>". Uploader is either the
      -- client themselves, or a pole staff member on a dossier of that client.
      (storage.foldername(name))[2] LIKE 'dm-%'
      AND (
        NULLIF(substring((storage.foldername(name))[2] from 4), '')::uuid = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.dossiers d
          WHERE d.client_id = NULLIF(substring((storage.foldername(name))[2] from 4), '')::uuid
            AND public.is_pole_member(auth.uid(), d.pole_id)
        )
      )
    )
  )
);

-- =========================================================
-- 3) dossiers UPDATE — clients cannot change sensitive fields.
--    Use a BEFORE UPDATE trigger to enforce column-level lock.
-- =========================================================
CREATE OR REPLACE FUNCTION public.enforce_dossier_client_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Staff can modify anything they can reach via RLS.
  IF public.has_role(auth.uid(), 'admin'::public.app_role)
     OR public.has_role(auth.uid(), 'direction'::public.app_role)
     OR public.is_pole_member(auth.uid(), COALESCE(NEW.pole_id, OLD.pole_id)) THEN
    RETURN NEW;
  END IF;

  -- Otherwise (client editing their own dossier): only description/titre
  -- may change. Everything else is locked.
  IF NEW.client_id     IS DISTINCT FROM OLD.client_id
     OR NEW.pole_id            IS DISTINCT FROM OLD.pole_id
     OR NEW.statut             IS DISTINCT FROM OLD.statut
     OR NEW.avancement         IS DISTINCT FROM OLD.avancement
     OR NEW.commentaire_agence IS DISTINCT FROM OLD.commentaire_agence
     OR NEW.categorie          IS DISTINCT FROM OLD.categorie
     OR NEW.site_web           IS DISTINCT FROM OLD.site_web THEN
    RAISE EXCEPTION 'Ce champ ne peut être modifié que par l''agence.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_dossier_client_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_dossier_client_update_trg ON public.dossiers;
CREATE TRIGGER enforce_dossier_client_update_trg
BEFORE UPDATE ON public.dossiers
FOR EACH ROW EXECUTE FUNCTION public.enforce_dossier_client_update();

-- =========================================================
-- 4) messages INSERT policies — enforce from_agence honestly,
--    remove client-as-staff overlap.
-- =========================================================
DROP POLICY IF EXISTS messages_insert_client ON public.messages;
DROP POLICY IF EXISTS messages_insert_staff  ON public.messages;

-- Client sending to their own thread: must be non-agence.
CREATE POLICY messages_insert_client ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND client_id = auth.uid()
  AND from_agence = false
  AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
  AND NOT public.has_role(auth.uid(), 'direction'::public.app_role)
);

-- Staff sending on behalf of the agency: must be agence, and must be
-- authorized on the target client thread.
CREATE POLICY messages_insert_staff ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND from_agence = true
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'direction'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.client_id = messages.client_id
        AND public.is_pole_member(auth.uid(), d.pole_id)
    )
  )
);
