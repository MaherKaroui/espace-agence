UPDATE public.qualiopi_calendar_events
SET status = 'certificat_a_recuperer'
WHERE status IN ('planifie', 'en_attente', 'realise')
  AND COALESCE(audit_date_end, audit_date) < now();

CREATE OR REPLACE FUNCTION public.qualiopi_flip_passed_audits()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE public.qualiopi_calendar_events
    SET status = 'certificat_a_recuperer'
    WHERE status IN ('planifie', 'en_attente', 'realise')
      AND COALESCE(audit_date_end, audit_date) < now()
    RETURNING id
  )
  SELECT count(*)::integer FROM updated;
$$;

REVOKE ALL ON FUNCTION public.qualiopi_flip_passed_audits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualiopi_flip_passed_audits() TO service_role;

SELECT cron.schedule('qualiopi-flip-passed-audits', '15 0 * * *', $$SELECT public.qualiopi_flip_passed_audits()$$);