CREATE OR REPLACE FUNCTION public.team_notification_recipients_for_pole(_pole_id uuid, _exclude_user_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH pole_recipients AS (
    SELECT DISTINCT pm.user_id
    FROM public.pole_members pm
    JOIN public.profiles pr ON pr.id = pm.user_id
    JOIN public.user_roles ur ON ur.user_id = pm.user_id
    WHERE _pole_id IS NOT NULL
      AND pm.pole_id = _pole_id
      AND (_exclude_user_id IS NULL OR pm.user_id <> _exclude_user_id)
      AND pr.archived_at IS NULL
      AND ur.role IN ('manager'::public.app_role, 'consultant'::public.app_role, 'admin'::public.app_role, 'direction'::public.app_role)
  ),
  oversight_recipients AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE (_exclude_user_id IS NULL OR ur.user_id <> _exclude_user_id)
      AND pr.archived_at IS NULL
      AND ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
      AND (_pole_id IS NULL OR EXISTS (SELECT 1 FROM pole_recipients))
  ),
  fallback_recipients AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE NOT EXISTS (SELECT 1 FROM pole_recipients)
      AND (_exclude_user_id IS NULL OR ur.user_id <> _exclude_user_id)
      AND pr.archived_at IS NULL
      AND ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
  )
  SELECT user_id FROM pole_recipients
  UNION
  SELECT user_id FROM oversight_recipients
  UNION
  SELECT user_id FROM fallback_recipients;
$$;