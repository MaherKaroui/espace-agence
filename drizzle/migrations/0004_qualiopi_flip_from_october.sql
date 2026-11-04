UPDATE public.qualiopi_calendar_events
SET status = 'realise'
WHERE status = 'certificat_a_recuperer'
  AND COALESCE(audit_date_end, audit_date) < DATE '2026-10-01';

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
      AND COALESCE(audit_date_end, audit_date) >= DATE '2026-10-01'
    RETURNING id
  )
  SELECT count(*)::integer FROM updated;
$$;

REVOKE ALL ON FUNCTION public.qualiopi_flip_passed_audits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualiopi_flip_passed_audits() TO service_role;