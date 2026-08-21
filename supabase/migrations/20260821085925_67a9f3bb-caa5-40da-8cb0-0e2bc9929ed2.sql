ALTER TABLE public.email_settings ADD COLUMN IF NOT EXISTS report_recipients text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.generer_rapport_quotidien(_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rap_id UUID;
  d_actifs INT; d_term INT; d_att INT; d_new INT;
  t_retard INT; t_done INT;
  m_24 INT; alerts INT;
  av_moy NUMERIC;
  rep_pole JSONB; rep_stat JSONB;
  since TIMESTAMPTZ := (_date::timestamptz - INTERVAL '1 day');
BEGIN
  SELECT count(*) FILTER (WHERE statut NOT IN ('termine','refuse')),
         count(*) FILTER (WHERE statut = 'termine'),
         count(*) FILTER (WHERE statut = 'a_completer'),
         count(*) FILTER (WHERE created_at >= since),
         COALESCE(AVG(avancement) FILTER (WHERE statut NOT IN ('termine','refuse')),0)
    INTO d_actifs, d_term, d_att, d_new, av_moy
    FROM public.dossiers;

  SELECT count(*) FILTER (WHERE status <> 'terminee' AND due_date IS NOT NULL AND due_date < now()),
         count(*) FILTER (WHERE status = 'terminee' AND completed_at >= since)
    INTO t_retard, t_done
    FROM public.agency_tasks
    WHERE archived_at IS NULL;

  SELECT count(*) INTO m_24 FROM public.messages WHERE created_at >= since;
  SELECT count(*) INTO alerts FROM public.audit_logs WHERE created_at >= since AND severity IN ('warning','critical');

  SELECT COALESCE(jsonb_object_agg(p.nom, cnt), '{}'::jsonb) INTO rep_pole FROM (
    SELECT p.nom, count(d.id) AS cnt
      FROM public.poles p LEFT JOIN public.dossiers d ON d.pole_id = p.id AND d.statut NOT IN ('termine','refuse')
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

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT ur.user_id, 'rapport_quotidien',
    'Rapport quotidien du '||to_char(_date,'DD/MM/YYYY'),
    d_actifs||' dossiers actifs · '||t_retard||' tâches en retard · '||alerts||' alertes sécurité',
    '/admin/direction'
  FROM public.user_roles ur WHERE ur.role IN ('direction','admin');

  RETURN rap_id;
END; $function$;