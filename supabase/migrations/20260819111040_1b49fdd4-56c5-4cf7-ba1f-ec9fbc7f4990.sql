
-- 1. app_errors
CREATE TABLE public.app_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  message text NOT NULL,
  stack text,
  url_page text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  navigateur text,
  gravite text NOT NULL DEFAULT 'mineur' CHECK (gravite IN ('critique','majeur','mineur')),
  statut text NOT NULL DEFAULT 'nouveau' CHECK (statut IN ('nouveau','vu','resolu')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_errors_created_idx ON public.app_errors (created_at DESC);
CREATE INDEX app_errors_statut_idx ON public.app_errors (statut, gravite);
GRANT INSERT ON public.app_errors TO anon, authenticated;
GRANT SELECT, UPDATE ON public.app_errors TO authenticated;
GRANT ALL ON public.app_errors TO service_role;
ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can log an error" ON public.app_errors FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "admins read errors" ON public.app_errors FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update errors" ON public.app_errors FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 2. health_checks
CREATE TABLE public.health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  http_status integer,
  response_time_ms integer,
  is_up boolean NOT NULL DEFAULT false,
  ssl_valid boolean,
  ssl_expires_at timestamptz,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_checks_created_idx ON public.health_checks (created_at DESC);
GRANT SELECT ON public.health_checks TO authenticated;
GRANT ALL ON public.health_checks TO service_role;
ALTER TABLE public.health_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read health" ON public.health_checks FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 3. data_anomalies
CREATE TABLE public.data_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_date date NOT NULL DEFAULT CURRENT_DATE,
  kind text NOT NULL,
  label text NOT NULL,
  gravite text NOT NULL DEFAULT 'mineur' CHECK (gravite IN ('critique','majeur','mineur')),
  count integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (check_date, kind)
);
GRANT SELECT ON public.data_anomalies TO authenticated;
GRANT ALL ON public.data_anomalies TO service_role;
ALTER TABLE public.data_anomalies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read anomalies" ON public.data_anomalies FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 4. ai_reports
CREATE TABLE public.ai_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  health_score integer NOT NULL DEFAULT 0,
  diagnostic text,
  problems jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_date)
);
GRANT SELECT ON public.ai_reports TO authenticated;
GRANT ALL ON public.ai_reports TO service_role;
ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read ai reports" ON public.ai_reports FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 5. ai_suggestions
CREATE TABLE public.ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.ai_reports(id) ON DELETE CASCADE,
  titre text NOT NULL,
  priorite text NOT NULL DEFAULT 'mineur' CHECK (priorite IN ('critique','majeur','mineur')),
  impact text,
  action text,
  statut text NOT NULL DEFAULT 'nouveau' CHECK (statut IN ('nouveau','a_faire','ignoree')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_suggestions_report_idx ON public.ai_suggestions (report_id);
GRANT SELECT, UPDATE ON public.ai_suggestions TO authenticated;
GRANT ALL ON public.ai_suggestions TO service_role;
ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read suggestions" ON public.ai_suggestions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update suggestions" ON public.ai_suggestions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 6. supervision_emails
CREATE TABLE public.supervision_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.supervision_emails TO authenticated;
GRANT ALL ON public.supervision_emails TO service_role;
ALTER TABLE public.supervision_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read supervision emails" ON public.supervision_emails FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 7. supervision_alerts (anti-spam)
CREATE TABLE public.supervision_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supervision_alerts_key_idx ON public.supervision_alerts (alert_key, created_at DESC);
GRANT SELECT ON public.supervision_alerts TO authenticated;
GRANT ALL ON public.supervision_alerts TO service_role;
ALTER TABLE public.supervision_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read supervision alerts" ON public.supervision_alerts FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 8. Cron jobs (réutilise le bearer déjà utilisé par les jobs existants)
DO $$
DECLARE
  existing text;
  bearer text;
  base text := 'https://project--51e3d791-7911-46e0-8fee-3de01cd0ad09.lovable.app';
BEGIN
  SELECT command INTO existing FROM cron.job WHERE jobname = 'izisuivis-reminders' LIMIT 1;
  bearer := (regexp_match(existing, 'Bearer ([A-Za-z0-9._-]+)'))[1];
  IF bearer IS NULL THEN RAISE NOTICE 'no bearer found, skipping cron'; RETURN; END IF;

  PERFORM cron.unschedule(jobname) FROM cron.job
   WHERE jobname IN ('izisuivis-health-check','izisuivis-ai-supervisor','izisuivis-supervision-report');

  PERFORM cron.schedule('izisuivis-health-check', '*/15 * * * *', format(
    $q$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization',%L), body := '{}'::jsonb);$q$,
    base || '/api/public/hooks/health-check', 'Bearer ' || bearer));

  -- 18h45 Europe/Paris -> 16:45 UTC (été) et 17:45 UTC (hiver) : le endpoint filtre l'heure locale
  PERFORM cron.schedule('izisuivis-ai-supervisor', '45 16,17 * * *', format(
    $q$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization',%L), body := '{}'::jsonb);$q$,
    base || '/api/public/hooks/ai-supervisor', 'Bearer ' || bearer));

  -- 19h00 Europe/Paris -> 17:00 UTC (été) et 18:00 UTC (hiver)
  PERFORM cron.schedule('izisuivis-supervision-report', '0 17,18 * * *', format(
    $q$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization',%L), body := '{}'::jsonb);$q$,
    base || '/api/public/hooks/supervision-report', 'Bearer ' || bearer));
END $$;
