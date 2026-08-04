-- 1) audit_logs: stop broadcasting via Realtime
ALTER PUBLICATION supabase_realtime DROP TABLE public.audit_logs;

-- 2) scope functions: explicit NULL guards
CREATE OR REPLACE FUNCTION public.client_in_scope(_staff uuid, _client uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _staff IS NOT NULL AND _client IS NOT NULL AND (
    public.has_role(_staff, 'admin'::app_role)
    OR public.has_role(_staff, 'direction'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.dossiers d
      JOIN public.poles p ON p.id = d.pole_id
      JOIN public.pole_members pm ON pm.pole_id = d.pole_id
      WHERE d.client_id = _client
        AND d.client_id IS NOT NULL
        AND d.pole_id IS NOT NULL
        AND p.actif = true
        AND pm.user_id = _staff
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.dossier_in_scope(_user uuid, _dossier uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user IS NOT NULL AND _dossier IS NOT NULL AND (
    public.has_role(_user, 'admin'::app_role)
    OR public.has_role(_user, 'direction'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.dossiers d
      JOIN public.poles p ON p.id = d.pole_id
      JOIN public.pole_members pm ON pm.pole_id = d.pole_id
      WHERE d.id = _dossier
        AND d.pole_id IS NOT NULL
        AND p.actif = true
        AND pm.user_id = _user
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.client_in_scope(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.dossier_in_scope(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.client_in_scope(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dossier_in_scope(uuid, uuid) TO authenticated, service_role;

-- 3) Qualiopi reference tables: restrict reads to signed-in users
DROP POLICY IF EXISTS qualiopi_criteria_read ON public.qualiopi_criteria;
CREATE POLICY qualiopi_criteria_read ON public.qualiopi_criteria
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS qualiopi_indicators_read ON public.qualiopi_indicators;
CREATE POLICY qualiopi_indicators_read ON public.qualiopi_indicators
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.qualiopi_criteria FROM anon;
REVOKE ALL ON public.qualiopi_indicators FROM anon;
GRANT SELECT ON public.qualiopi_criteria TO authenticated;
GRANT SELECT ON public.qualiopi_indicators TO authenticated;
GRANT ALL ON public.qualiopi_criteria TO service_role;
GRANT ALL ON public.qualiopi_indicators TO service_role;