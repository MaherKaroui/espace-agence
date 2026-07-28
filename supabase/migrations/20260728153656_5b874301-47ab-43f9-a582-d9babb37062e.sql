
-- 1) Restrict policies to authenticated role (drop + recreate scoped to authenticated)

-- documents_read_assigned
DROP POLICY IF EXISTS documents_read_assigned ON public.documents;
CREATE POLICY documents_read_assigned ON public.documents
  FOR SELECT TO authenticated
  USING (public.is_assigned_to_dossier(auth.uid(), dossier_id));

-- dossier_assignments policies
DROP POLICY IF EXISTS assignments_read_scope ON public.dossier_assignments;
CREATE POLICY assignments_read_scope ON public.dossier_assignments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR user_id = auth.uid()
    OR public.dossier_in_scope(auth.uid(), dossier_id)
  );

DROP POLICY IF EXISTS assignments_write_staff ON public.dossier_assignments;
CREATE POLICY assignments_write_staff ON public.dossier_assignments
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR public.dossier_in_scope(auth.uid(), dossier_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR public.dossier_in_scope(auth.uid(), dossier_id)
  );

-- dossiers_read_assigned
DROP POLICY IF EXISTS dossiers_read_assigned ON public.dossiers;
CREATE POLICY dossiers_read_assigned ON public.dossiers
  FOR SELECT TO authenticated
  USING (public.is_assigned_to_dossier(auth.uid(), id));

-- user_sessions policies
DROP POLICY IF EXISTS sessions_insert_own ON public.user_sessions;
CREATE POLICY sessions_insert_own ON public.user_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS sessions_select_own_or_admin ON public.user_sessions;
CREATE POLICY sessions_select_own_or_admin ON public.user_sessions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
  );

DROP POLICY IF EXISTS sessions_update_own ON public.user_sessions;
CREATE POLICY sessions_update_own ON public.user_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2) Revoke EXECUTE from anon/public for internal SECURITY DEFINER trigger functions
REVOKE EXECUTE ON FUNCTION public.trg_qualiopi_request_reviewed() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.on_dossier_assignment_change() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_qualiopi_external_message() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_qualiopi_document_uploaded() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_qualiopi_request_created() FROM PUBLIC, anon;
