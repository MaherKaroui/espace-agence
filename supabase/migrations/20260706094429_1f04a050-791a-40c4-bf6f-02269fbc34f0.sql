CREATE OR REPLACE FUNCTION public.get_presence(_ids uuid[])
RETURNS TABLE(user_id uuid, last_seen_at timestamptz, online boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.user_id,
         MAX(COALESCE(s.last_seen_at, s.started_at)) AS last_seen_at,
         BOOL_OR(s.ended_at IS NULL AND COALESCE(s.last_seen_at, s.started_at) > now() - interval '5 minutes') AS online
  FROM public.user_sessions s
  WHERE s.user_id = ANY(_ids)
    AND (
      public.is_agency_member(auth.uid())
      OR auth.uid() = ANY(_ids)
    )
  GROUP BY s.user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_presence(uuid[]) TO authenticated;