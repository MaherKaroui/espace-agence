
CREATE TABLE public.rapports_quotidiens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date_rapport DATE NOT NULL UNIQUE,
  dossiers_actifs INT NOT NULL DEFAULT 0,
  dossiers_termines INT NOT NULL DEFAULT 0,
  dossiers_en_attente_client INT NOT NULL DEFAULT 0,
  dossiers_nouveaux INT NOT NULL DEFAULT 0,
  taches_en_retard INT NOT NULL DEFAULT 0,
  taches_terminees_24h INT NOT NULL DEFAULT 0,
  messages_24h INT NOT NULL DEFAULT 0,
  alertes_securite_24h INT NOT NULL DEFAULT 0,
  avancement_moyen NUMERIC(5,2) NOT NULL DEFAULT 0,
  repartition_pole JSONB NOT NULL DEFAULT '{}'::jsonb,
  repartition_statut JSONB NOT NULL DEFAULT '{}'::jsonb,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.rapports_quotidiens TO authenticated;
GRANT ALL ON public.rapports_quotidiens TO service_role;
ALTER TABLE public.rapports_quotidiens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Direction/Admin can read rapports" ON public.rapports_quotidiens FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'));
CREATE POLICY "Direction/Admin can insert rapports" ON public.rapports_quotidiens FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'));

-- Function to generate daily report (idempotent for a given date)
CREATE OR REPLACE FUNCTION public.generer_rapport_quotidien(_date DATE DEFAULT CURRENT_DATE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rap_id UUID;
  d_actifs INT; d_term INT; d_att INT; d_new INT;
  t_retard INT; t_done INT;
  m_24 INT; alerts INT;
  av_moy NUMERIC;
  rep_pole JSONB; rep_stat JSONB;
  since TIMESTAMPTZ := (_date::timestamptz - INTERVAL '1 day');
BEGIN
  SELECT count(*) FILTER (WHERE statut NOT IN ('termine','annule')),
         count(*) FILTER (WHERE statut = 'termine'),
         count(*) FILTER (WHERE statut = 'a_completer'),
         count(*) FILTER (WHERE created_at >= since),
         COALESCE(AVG(avancement) FILTER (WHERE statut NOT IN ('termine','annule')),0)
    INTO d_actifs, d_term, d_att, d_new, av_moy
    FROM public.dossiers;

  SELECT count(*) FILTER (WHERE statut NOT IN ('termine','annule') AND date_echeance IS NOT NULL AND date_echeance < CURRENT_DATE),
         count(*) FILTER (WHERE statut = 'termine' AND completed_at >= since)
    INTO t_retard, t_done
    FROM public.taches;

  SELECT count(*) INTO m_24 FROM public.messages WHERE created_at >= since;
  SELECT count(*) INTO alerts FROM public.audit_logs WHERE created_at >= since AND severity IN ('warning','critical');

  SELECT COALESCE(jsonb_object_agg(p.nom, cnt), '{}'::jsonb) INTO rep_pole FROM (
    SELECT p.nom, count(d.id) AS cnt
      FROM public.poles p LEFT JOIN public.dossiers d ON d.pole_id = p.id AND d.statut NOT IN ('termine','annule')
      GROUP BY p.nom
  ) p;

  SELECT COALESCE(jsonb_object_agg(statut, cnt), '{}'::jsonb) INTO rep_stat FROM (
    SELECT statut::text, count(*) AS cnt FROM public.dossiers GROUP BY statut
  ) s;

  INSERT INTO public.rapports_quotidiens (
    date_rapport, dossiers_actifs, dossiers_termines, dossiers_en_attente_client, dossiers_nouveaux,
    taches_en_retard, taches_terminees_24h, messages_24h, alertes_securite_24h,
    avancement_moyen, repartition_pole, repartition_statut
  ) VALUES (
    _date, d_actifs, d_term, d_att, d_new,
    t_retard, t_done, m_24, alerts,
    ROUND(av_moy,2), rep_pole, rep_stat
  )
  ON CONFLICT (date_rapport) DO UPDATE SET
    dossiers_actifs = EXCLUDED.dossiers_actifs,
    dossiers_termines = EXCLUDED.dossiers_termines,
    dossiers_en_attente_client = EXCLUDED.dossiers_en_attente_client,
    dossiers_nouveaux = EXCLUDED.dossiers_nouveaux,
    taches_en_retard = EXCLUDED.taches_en_retard,
    taches_terminees_24h = EXCLUDED.taches_terminees_24h,
    messages_24h = EXCLUDED.messages_24h,
    alertes_securite_24h = EXCLUDED.alertes_securite_24h,
    avancement_moyen = EXCLUDED.avancement_moyen,
    repartition_pole = EXCLUDED.repartition_pole,
    repartition_statut = EXCLUDED.repartition_statut,
    created_at = now()
  RETURNING id INTO rap_id;

  -- Notify direction/admin
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT ur.user_id, 'rapport_quotidien',
    'Rapport quotidien du '||to_char(_date,'DD/MM/YYYY'),
    d_actifs||' dossiers actifs · '||t_retard||' tâches en retard · '||alerts||' alertes sécurité',
    '/admin/direction'
  FROM public.user_roles ur WHERE ur.role IN ('direction','admin');

  RETURN rap_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.generer_rapport_quotidien(DATE) TO authenticated;

-- Schedule daily at 07:00 UTC (~08:00-09:00 Paris)
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  PERFORM cron.unschedule('rapport-quotidien-direction');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('rapport-quotidien-direction', '0 7 * * *',
  $$ SELECT public.generer_rapport_quotidien(CURRENT_DATE) $$);
