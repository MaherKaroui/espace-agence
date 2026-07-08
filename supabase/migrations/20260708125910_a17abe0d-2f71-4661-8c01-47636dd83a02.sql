
-- Email settings singleton
CREATE TABLE public.email_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  admin_email TEXT NOT NULL DEFAULT 'admin@izi-business.com',
  disabled_templates TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT, INSERT, UPDATE ON public.email_settings TO authenticated;
GRANT ALL ON public.email_settings TO service_role;

ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/direction can view email settings"
  ON public.email_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));

CREATE POLICY "Admin can update email settings"
  ON public.email_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can insert email settings"
  ON public.email_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER email_settings_touch_updated_at
  BEFORE UPDATE ON public.email_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed singleton row
INSERT INTO public.email_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Helper RPC (readable by all authenticated to allow client mutations to know if disabled)
CREATE OR REPLACE FUNCTION public.email_template_enabled(_template_name TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT COALESCE(_template_name = ANY(disabled_templates), FALSE)
    FROM public.email_settings WHERE id = 1
  UNION ALL SELECT TRUE
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.email_template_enabled(TEXT) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.get_admin_email()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT admin_email FROM public.email_settings WHERE id = 1
  UNION ALL SELECT 'admin@izi-business.com'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_email() TO authenticated, service_role;
