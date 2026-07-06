-- Fix admin-only posting bypass in announcement channels
CREATE OR REPLACE FUNCTION public.can_post_internal_conv(_user uuid, _conv uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.can_view_internal_conv(_user, _conv)
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.internal_conversations c
        WHERE c.id = _conv AND c.admin_only_posting = true
      )
      OR public.has_role(_user, 'admin'::app_role)
      OR public.has_role(_user, 'direction'::app_role)
    );
$$;

-- Revoke EXECUTE from PUBLIC and anon on all SECURITY DEFINER functions in public schema.
-- These functions should only be called by authenticated users or as internal triggers.
REVOKE EXECUTE ON FUNCTION public.notify_internal_mentions() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.archive_client(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_internal_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_agency_task(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dossier_in_scope(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_internal_conv(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_agency_task_change() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_new_internal_message() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.client_in_scope(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_internal_contact(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unarchive_client(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_presence(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_internal_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_agency_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_dossier_change_audit() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_post_internal_conv(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_document_status_audit() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_client_note_audit() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generer_rapport_direction(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_internal_message_insert_audit() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_rdv_audit() FROM PUBLIC, anon;
