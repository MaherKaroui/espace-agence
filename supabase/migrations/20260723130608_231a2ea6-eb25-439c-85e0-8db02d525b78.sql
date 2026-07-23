DROP INDEX IF EXISTS public.push_subscriptions_user_endpoint_key;
DROP INDEX IF EXISTS public.push_subscriptions_endpoint_key;
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_key
  ON public.push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subs_user
  ON public.push_subscriptions (user_id);

CREATE OR REPLACE FUNCTION public.save_push_subscription(
  _endpoint text,
  _p256dh text,
  _auth text,
  _user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
  VALUES (auth.uid(), _endpoint, _p256dh, _auth, _user_agent, now())
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = auth.uid(),
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    last_used_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.team_notification_recipients_for_pole(_pole_id uuid, _exclude_user_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH active_pole_recipients AS (
    SELECT DISTINCT pm.user_id
    FROM public.pole_members pm
    JOIN public.profiles pr ON pr.id = pm.user_id
    JOIN public.user_roles ur ON ur.user_id = pm.user_id
    WHERE _pole_id IS NOT NULL
      AND pm.pole_id = _pole_id
      AND (_exclude_user_id IS NULL OR pm.user_id <> _exclude_user_id)
      AND pr.archived_at IS NULL
      AND ur.role IN (
        'manager'::public.app_role,
        'consultant'::public.app_role,
        'admin'::public.app_role,
        'direction'::public.app_role
      )
  ),
  fallback_recipients AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE NOT EXISTS (SELECT 1 FROM active_pole_recipients)
      AND (_exclude_user_id IS NULL OR ur.user_id <> _exclude_user_id)
      AND ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
      AND pr.archived_at IS NULL
  )
  SELECT apr.user_id FROM active_pole_recipients apr
  UNION
  SELECT fr.user_id FROM fallback_recipients fr;
$$;