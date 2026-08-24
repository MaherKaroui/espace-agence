CREATE TABLE public.client_acces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  organisme text,
  libelle text NOT NULL,
  plateforme text,
  url text,
  identifiant text,
  secret_ciphertext text,
  notes text,
  source text NOT NULL DEFAULT 'manuel',
  manual_locked boolean NOT NULL DEFAULT false,
  slack_channel text,
  slack_message_ts text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX client_acces_slack_unique
  ON public.client_acces (slack_channel, slack_message_ts, libelle)
  WHERE slack_channel IS NOT NULL AND slack_message_ts IS NOT NULL;

CREATE INDEX client_acces_client_idx ON public.client_acces (client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_acces TO authenticated;
GRANT ALL ON public.client_acces TO service_role;

ALTER TABLE public.client_acces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acces_staff_select" ON public.client_acces FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  AND (dossier_id IS NULL OR public.dossier_in_scope(auth.uid(), dossier_id))
);

CREATE POLICY "acces_staff_insert" ON public.client_acces FOR INSERT TO authenticated
WITH CHECK (
  public.is_staff(auth.uid())
  AND created_by = auth.uid()
  AND (dossier_id IS NULL OR public.dossier_in_scope(auth.uid(), dossier_id))
);

CREATE POLICY "acces_staff_update" ON public.client_acces FOR UPDATE TO authenticated
USING (
  public.is_staff(auth.uid())
  AND (dossier_id IS NULL OR public.dossier_in_scope(auth.uid(), dossier_id))
)
WITH CHECK (
  public.is_staff(auth.uid())
  AND (dossier_id IS NULL OR public.dossier_in_scope(auth.uid(), dossier_id))
);

CREATE POLICY "acces_staff_delete" ON public.client_acces FOR DELETE TO authenticated
USING (
  public.is_staff(auth.uid())
  AND (dossier_id IS NULL OR public.dossier_in_scope(auth.uid(), dossier_id))
);

CREATE TRIGGER client_acces_touch
  BEFORE UPDATE ON public.client_acces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.client_acces_slack_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO public.client_acces_slack_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON public.client_acces_slack_settings TO authenticated;
GRANT ALL ON public.client_acces_slack_settings TO service_role;

ALTER TABLE public.client_acces_slack_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acces_slack_settings_select" ON public.client_acces_slack_settings FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'direction'::app_role));

CREATE POLICY "acces_slack_settings_update" ON public.client_acces_slack_settings FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'direction'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'direction'::app_role));