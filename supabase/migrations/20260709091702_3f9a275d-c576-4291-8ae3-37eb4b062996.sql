UPDATE public.email_settings
SET admin_email = 'admin@izisuivis.com', updated_at = now()
WHERE id = 1
  AND lower(admin_email) IN ('admin@izi-business.com', 'admin@izibusiness.com');

GRANT SELECT ON public.email_send_log TO authenticated;

DO $$
BEGIN
  CREATE POLICY "Admin and direction can view email send log"
    ON public.email_send_log
    FOR SELECT
    TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'direction'::public.app_role)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;