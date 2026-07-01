
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.rendez_vous (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dossier_id UUID REFERENCES public.dossiers(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirme',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rendez_vous_time_check CHECK (ends_at > starts_at)
);

CREATE INDEX rendez_vous_starts_at_idx ON public.rendez_vous (starts_at);
CREATE UNIQUE INDEX rendez_vous_slot_unique ON public.rendez_vous (starts_at) WHERE status <> 'annule';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rendez_vous TO authenticated;
GRANT ALL ON public.rendez_vous TO service_role;

ALTER TABLE public.rendez_vous ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rdv_client_select_own" ON public.rendez_vous
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

CREATE POLICY "rdv_staff_select_all" ON public.rendez_vous
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'consultant'::app_role)
  );

CREATE POLICY "rdv_client_insert_own" ON public.rendez_vous
  FOR INSERT TO authenticated
  WITH CHECK (client_id = auth.uid());

CREATE POLICY "rdv_client_update_own" ON public.rendez_vous
  FOR UPDATE TO authenticated
  USING (client_id = auth.uid())
  WITH CHECK (client_id = auth.uid());

CREATE POLICY "rdv_admin_delete" ON public.rendez_vous
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
  );

CREATE TRIGGER update_rendez_vous_updated_at
  BEFORE UPDATE ON public.rendez_vous
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
