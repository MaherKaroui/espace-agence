
-- 1) audit_logs : empêcher les insertions par les clients (log_event RPC SECURITY DEFINER reste utilisable côté serveur)
DROP POLICY IF EXISTS "Users can insert their own audit rows" ON public.audit_logs;
REVOKE INSERT ON public.audit_logs FROM authenticated, anon;

-- 2) profiles : tightener la clause shares_conversation pour n'exposer les profils qu'aux relations impliquant au moins un membre agence
DROP POLICY IF EXISTS profiles_select_scoped ON public.profiles;
CREATE POLICY profiles_select_scoped ON public.profiles
FOR SELECT TO authenticated
USING (
  (auth.uid() = id)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'direction'::app_role)
  OR ((archived_at IS NULL) AND public.client_in_scope(auth.uid(), id))
  OR (
    public.shares_conversation(auth.uid(), id)
    AND (public.is_staff(auth.uid()) OR public.is_staff(id))
  )
);

-- 3) Révoquer EXECUTE aux rôles anon et PUBLIC sur toutes les fonctions SECURITY DEFINER du schéma public
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, PUBLIC', r.proname, r.args);
  END LOOP;
END $$;
