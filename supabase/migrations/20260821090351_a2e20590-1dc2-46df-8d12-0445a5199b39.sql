CREATE OR REPLACE FUNCTION public.cron_jobs_health()
RETURNS TABLE(
  jobname text,
  schedule text,
  active boolean,
  last_start timestamp with time zone,
  last_status text,
  last_message text,
  recent_failures integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT j.jobname::text,
         j.schedule::text,
         j.active,
         r.start_time,
         r.status::text,
         left(coalesce(r.return_message, ''), 300),
         (
           SELECT count(*)::int FROM cron.job_run_details d
           WHERE d.jobid = j.jobid
             AND d.start_time > now() - interval '1 hour'
             AND d.status <> 'succeeded'
         )
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT d.start_time, d.status, d.return_message
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.start_time DESC
    LIMIT 1
  ) r ON true
  ORDER BY j.jobname;
$$;

REVOKE ALL ON FUNCTION public.cron_jobs_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_jobs_health() TO service_role;