
-- 1. Helper: staff sees a client only if admin/direction, OR client has a dossier in a shared pôle
CREATE OR REPLACE FUNCTION public.staff_can_view_client(_staff_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.has_role(_staff_id, 'admin'::app_role)
    OR public.has_role(_staff_id, 'direction'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.dossiers d
      JOIN public.pole_members pm ON pm.pole_id = d.pole_id
      WHERE d.client_id = _client_id
        AND pm.user_id = _staff_id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.staff_can_view_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_can_view_client(uuid, uuid) TO authenticated;

-- 2. Restrict profiles SELECT: replace overly-broad "shares_conversation" with scoped staff access
DROP POLICY IF EXISTS "profiles_select_self_admin_or_shared_group" ON public.profiles;

CREATE POLICY "profiles_select_scoped"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = id
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'direction'::app_role)
  OR public.staff_can_view_client(auth.uid(), id)
  OR public.shares_conversation(auth.uid(), id)
);

-- 3. Prevent dossier creation on inactive pôles (staff + client)
DROP POLICY IF EXISTS "dossiers_insert_staff" ON public.dossiers;
CREATE POLICY "dossiers_insert_staff"
ON public.dossiers
FOR INSERT
TO authenticated
WITH CHECK (
  (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR public.is_pole_member(auth.uid(), pole_id)
  )
  AND (
    pole_id IS NULL
    OR EXISTS (SELECT 1 FROM public.poles p WHERE p.id = pole_id AND p.actif = true)
  )
);

DROP POLICY IF EXISTS "dossiers_insert_client" ON public.dossiers;
CREATE POLICY "dossiers_insert_client"
ON public.dossiers
FOR INSERT
TO authenticated
WITH CHECK (
  (client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  AND (
    pole_id IS NULL
    OR EXISTS (SELECT 1 FROM public.poles p WHERE p.id = pole_id AND p.actif = true)
  )
);
