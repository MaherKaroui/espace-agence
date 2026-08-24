UPDATE public.email_settings
SET admin_email = 'admin@izi-business.com', updated_at = now()
WHERE id = 1 AND lower(admin_email) IN ('admin@izisuivis.com', 'admin@izibusiness.com');

UPDATE public.email_settings
SET report_recipients = (
  SELECT array_agg(replace(lower(e), '@izisuivis.com', '@izi-business.com'))
  FROM unnest(report_recipients) AS e
)
WHERE report_recipients IS NOT NULL
  AND EXISTS (SELECT 1 FROM unnest(report_recipients) AS e WHERE lower(e) LIKE '%@izisuivis.com');

ALTER TABLE public.email_settings ALTER COLUMN admin_email SET DEFAULT 'admin@izi-business.com';

CREATE OR REPLACE FUNCTION public.get_admin_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT admin_email FROM public.email_settings WHERE id = 1
  UNION ALL SELECT 'admin@izi-business.com'
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_email() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_admin_email() TO authenticated, service_role;