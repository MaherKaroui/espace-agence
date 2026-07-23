
-- Enum statut évènement
DO $$ BEGIN
  CREATE TYPE public.qualiopi_event_status AS ENUM ('planifie','en_attente','realise','annule','certificat_a_recuperer','certificat_recu');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.qualiopi_followup_status AS ENUM ('attente_contrat','attente_paiement','attente_facture','attente_docs','attente_retour_certificateur','recuperation_certificat','autre');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) Calendrier
CREATE TABLE IF NOT EXISTS public.qualiopi_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_date DATE NOT NULL,
  organism_name TEXT NOT NULL,
  formation TEXT,
  auditor_name TEXT,
  auditor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  certifier_name TEXT,
  certifier_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  certifier_organization TEXT,
  certificate_status TEXT,
  status public.qualiopi_event_status NOT NULL DEFAULT 'planifie',
  observation TEXT,
  dossier_id UUID REFERENCES public.dossiers(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qualiopi_calendar_events TO authenticated;
GRANT ALL ON public.qualiopi_calendar_events TO service_role;

ALTER TABLE public.qualiopi_calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qualiopi_calendar staff full access"
ON public.qualiopi_calendar_events FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'direction')
  OR public.has_role(auth.uid(),'manager')
  OR public.has_role(auth.uid(),'consultant')
)
WITH CHECK (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'direction')
  OR public.has_role(auth.uid(),'manager')
  OR public.has_role(auth.uid(),'consultant')
);

CREATE POLICY "qualiopi_calendar external read own"
ON public.qualiopi_calendar_events FOR SELECT TO authenticated
USING (
  auth.uid() = auditor_user_id
  OR auth.uid() = certifier_user_id
);

CREATE INDEX IF NOT EXISTS idx_qcal_date ON public.qualiopi_calendar_events(audit_date);
CREATE INDEX IF NOT EXISTS idx_qcal_dossier ON public.qualiopi_calendar_events(dossier_id);

-- 2) Demandes en cours
CREATE TABLE IF NOT EXISTS public.qualiopi_pending_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organism_name TEXT NOT NULL,
  certifier TEXT,
  observation TEXT,
  followup_status public.qualiopi_followup_status NOT NULL DEFAULT 'autre',
  priority TEXT,
  due_date DATE,
  dossier_id UUID REFERENCES public.dossiers(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qualiopi_pending_requests TO authenticated;
GRANT ALL ON public.qualiopi_pending_requests TO service_role;

ALTER TABLE public.qualiopi_pending_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qualiopi_pending staff full access"
ON public.qualiopi_pending_requests FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'direction')
  OR public.has_role(auth.uid(),'manager')
  OR public.has_role(auth.uid(),'consultant')
)
WITH CHECK (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'direction')
  OR public.has_role(auth.uid(),'manager')
  OR public.has_role(auth.uid(),'consultant')
);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.qualiopi_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_qcal_touch ON public.qualiopi_calendar_events;
CREATE TRIGGER trg_qcal_touch BEFORE UPDATE ON public.qualiopi_calendar_events
FOR EACH ROW EXECUTE FUNCTION public.qualiopi_touch_updated_at();

DROP TRIGGER IF EXISTS trg_qpen_touch ON public.qualiopi_pending_requests;
CREATE TRIGGER trg_qpen_touch BEFORE UPDATE ON public.qualiopi_pending_requests
FOR EACH ROW EXECUTE FUNCTION public.qualiopi_touch_updated_at();
