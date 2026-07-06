
-- =========== Table daily_direction_reports ===========
CREATE TABLE IF NOT EXISTS public.daily_direction_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date DATE NOT NULL UNIQUE,
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_reports_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  pole_reports_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  client_reports_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  hourly_activity_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions_count INT NOT NULL DEFAULT 0,
  messages_count INT NOT NULL DEFAULT 0,
  documents_count INT NOT NULL DEFAULT 0,
  dossiers_modified_count INT NOT NULL DEFAULT 0,
  relances_count INT NOT NULL DEFAULT 0,
  active_users_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.daily_direction_reports TO authenticated;
GRANT ALL ON public.daily_direction_reports TO service_role;

ALTER TABLE public.daily_direction_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ddr_select_direction" ON public.daily_direction_reports;
CREATE POLICY "ddr_select_direction" ON public.daily_direction_reports
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'direction'::app_role));

DROP POLICY IF EXISTS "ddr_insert_direction" ON public.daily_direction_reports;
CREATE POLICY "ddr_insert_direction" ON public.daily_direction_reports
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'direction'::app_role));

DROP POLICY IF EXISTS "ddr_update_direction" ON public.daily_direction_reports;
CREATE POLICY "ddr_update_direction" ON public.daily_direction_reports
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'direction'::app_role));

DROP TRIGGER IF EXISTS trg_ddr_updated_at ON public.daily_direction_reports;
CREATE TRIGGER trg_ddr_updated_at BEFORE UPDATE ON public.daily_direction_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========== Audit triggers manquants ===========

-- dossier changes
CREATE OR REPLACE FUNCTION public.on_dossier_change_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'dossier.created', 'dossier', NEW.id, 'info',
      jsonb_build_object('titre', NEW.titre, 'client_id', NEW.client_id, 'pole_id', NEW.pole_id, 'statut', NEW.statut));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.statut IS DISTINCT FROM OLD.statut THEN
      INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (auth.uid(), 'dossier.status_changed', 'dossier', NEW.id, 'info',
        jsonb_build_object('titre', NEW.titre, 'client_id', NEW.client_id, 'old', OLD.statut, 'new', NEW.statut));
    END IF;
    IF NEW.avancement IS DISTINCT FROM OLD.avancement
       OR NEW.commentaire_agence IS DISTINCT FROM OLD.commentaire_agence
       OR NEW.titre IS DISTINCT FROM OLD.titre
       OR NEW.description IS DISTINCT FROM OLD.description THEN
      INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (auth.uid(), 'dossier.updated', 'dossier', NEW.id, 'info',
        jsonb_build_object('titre', NEW.titre, 'client_id', NEW.client_id));
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_dossier_audit ON public.dossiers;
CREATE TRIGGER trg_dossier_audit AFTER INSERT OR UPDATE ON public.dossiers
  FOR EACH ROW EXECUTE FUNCTION public.on_dossier_change_audit();

-- document status changes
CREATE OR REPLACE FUNCTION public.on_document_status_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(),
      CASE NEW.statut WHEN 'accepte' THEN 'document.validated' WHEN 'refuse' THEN 'document.rejected' ELSE 'document.status_changed' END,
      'document', NEW.id, 'info',
      jsonb_build_object('dossier_id', NEW.dossier_id, 'nom', NEW.nom, 'old', OLD.statut, 'new', NEW.statut));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_document_status_audit ON public.documents;
CREATE TRIGGER trg_document_status_audit AFTER UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.on_document_status_audit();

-- client_notes
CREATE OR REPLACE FUNCTION public.on_client_note_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (NEW.author_id, 'client_note.added', 'client_note', NEW.id, 'info',
    jsonb_build_object('client_id', NEW.client_id, 'length', COALESCE(length(NEW.contenu),0)));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_client_note_audit ON public.client_notes;
CREATE TRIGGER trg_client_note_audit AFTER INSERT ON public.client_notes
  FOR EACH ROW EXECUTE FUNCTION public.on_client_note_audit();

-- rendez_vous
CREATE OR REPLACE FUNCTION public.on_rdv_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'rendezvous.created', 'rendezvous', NEW.id, 'info',
      jsonb_build_object('client_id', NEW.client_id, 'starts_at', NEW.starts_at, 'status', NEW.status));
  ELSIF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.starts_at IS DISTINCT FROM OLD.starts_at) THEN
    INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'rendezvous.updated', 'rendezvous', NEW.id, 'info',
      jsonb_build_object('client_id', NEW.client_id, 'status', NEW.status, 'starts_at', NEW.starts_at));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rdv_audit ON public.rendez_vous;
CREATE TRIGGER trg_rdv_audit AFTER INSERT OR UPDATE ON public.rendez_vous
  FOR EACH ROW EXECUTE FUNCTION public.on_rdv_audit();

-- Indexes utiles pour le rapport
CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx ON public.audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_created_idx ON public.audit_logs(action, created_at DESC);

-- =========== RPC générateur de rapport ===========
CREATE OR REPLACE FUNCTION public.generer_rapport_direction(_date DATE DEFAULT CURRENT_DATE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rap_id UUID;
  tz TEXT := 'Europe/Paris';
  day_start TIMESTAMPTZ := (_date::text || ' 00:00:00')::timestamp AT TIME ZONE tz;
  day_end   TIMESTAMPTZ := ((_date + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE tz;
  v_summary JSONB;
  v_users JSONB;
  v_poles JSONB;
  v_clients JSONB;
  v_hourly JSONB;
  v_actions INT;
  v_msgs INT;
  v_docs INT;
  v_dossiers INT;
  v_relances INT;
  v_active_users INT;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'direction'::app_role)) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  -- actions du jour
  WITH day_logs AS (
    SELECT * FROM public.audit_logs
    WHERE created_at >= day_start AND created_at < day_end
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE action IN ('message.sent','group_message.sent','internal_message.sent'))::int,
    count(*) FILTER (WHERE action IN ('document.uploaded','document.validated','document.rejected'))::int,
    count(*) FILTER (WHERE action IN ('dossier.created','dossier.updated','dossier.status_changed'))::int,
    count(*) FILTER (WHERE action = 'relance.sent')::int,
    count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::int
  INTO v_actions, v_msgs, v_docs, v_dossiers, v_relances, v_active_users
  FROM day_logs;

  -- Rapport global
  v_summary := jsonb_build_object(
    'date', _date,
    'actions', COALESCE(v_actions,0),
    'messages', COALESCE(v_msgs,0),
    'documents', COALESCE(v_docs,0),
    'dossiers_modifies', COALESCE(v_dossiers,0),
    'relances', COALESCE(v_relances,0),
    'active_users', COALESCE(v_active_users,0),
    'alertes', (SELECT count(*) FROM public.audit_logs
                WHERE created_at >= day_start AND created_at < day_end
                  AND severity IN ('warning','critical')),
    'taches_en_retard', (SELECT count(*) FROM public.taches
                          WHERE statut NOT IN ('termine','annule')
                            AND date_echeance IS NOT NULL AND date_echeance < CURRENT_DATE),
    'clients_actifs', (SELECT count(DISTINCT al.user_id) FROM public.audit_logs al
                        JOIN public.user_roles ur ON ur.user_id = al.user_id
                        WHERE al.created_at >= day_start AND al.created_at < day_end
                          AND ur.role = 'client'),
    'staff_actif', (SELECT count(DISTINCT al.user_id) FROM public.audit_logs al
                     JOIN public.user_roles ur ON ur.user_id = al.user_id
                     WHERE al.created_at >= day_start AND al.created_at < day_end
                       AND ur.role IN ('admin','direction','manager','consultant'))
  );

  -- Activité par utilisateur
  SELECT COALESCE(jsonb_agg(row_to_json(u)), '[]'::jsonb) INTO v_users FROM (
    SELECT
      al.user_id,
      COALESCE(p.prenom || ' ' || p.nom, p.email, al.user_id::text) AS name,
      p.email,
      (SELECT array_agg(role::text) FROM public.user_roles WHERE user_id = al.user_id) AS roles,
      (SELECT array_agg(DISTINCT po.nom) FROM public.pole_members pm
        JOIN public.poles po ON po.id = pm.pole_id WHERE pm.user_id = al.user_id) AS poles,
      min(al.created_at) AS first_action,
      max(al.created_at) AS last_action,
      count(*)::int AS actions,
      count(*) FILTER (WHERE al.action = 'message.sent')::int AS messages,
      count(*) FILTER (WHERE al.action = 'internal_message.sent')::int AS internal_messages,
      count(*) FILTER (WHERE al.action = 'group_message.sent')::int AS group_messages,
      count(*) FILTER (WHERE al.action = 'document.uploaded')::int AS documents_uploaded,
      count(*) FILTER (WHERE al.action = 'document.validated')::int AS documents_validated,
      count(*) FILTER (WHERE al.action = 'document.rejected')::int AS documents_rejected,
      count(*) FILTER (WHERE al.action IN ('dossier.updated','dossier.status_changed'))::int AS dossiers_modifies,
      count(*) FILTER (WHERE al.action = 'relance.sent')::int AS relances,
      count(*) FILTER (WHERE al.action = 'client_note.added')::int AS notes,
      (SELECT COALESCE(SUM(COALESCE(us.duration_seconds,
              GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(us.ended_at, us.last_seen_at) - us.started_at))::int))), 0)::int
       FROM public.user_sessions us
       WHERE us.user_id = al.user_id AND us.started_at >= day_start AND us.started_at < day_end) AS session_seconds
    FROM public.audit_logs al
    LEFT JOIN public.profiles p ON p.id = al.user_id
    WHERE al.created_at >= day_start AND al.created_at < day_end
      AND al.user_id IS NOT NULL
    GROUP BY al.user_id, p.prenom, p.nom, p.email
    ORDER BY count(*) DESC
  ) u;

  -- Par pôle (via dossiers touchés)
  SELECT COALESCE(jsonb_agg(row_to_json(p)), '[]'::jsonb) INTO v_poles FROM (
    SELECT po.id, po.nom, po.code,
      count(DISTINCT d.id)::int AS dossiers_touches,
      count(al.id)::int AS actions
    FROM public.poles po
    LEFT JOIN public.dossiers d ON d.pole_id = po.id
    LEFT JOIN public.audit_logs al ON al.entity_id = d.id AND al.entity_type = 'dossier'
      AND al.created_at >= day_start AND al.created_at < day_end
    GROUP BY po.id, po.nom, po.code
    ORDER BY actions DESC
  ) p;

  -- Top clients actifs
  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_clients FROM (
    SELECT
      al.user_id AS client_id,
      COALESCE(p.prenom || ' ' || p.nom, p.email) AS name,
      count(*)::int AS actions
    FROM public.audit_logs al
    JOIN public.user_roles ur ON ur.user_id = al.user_id AND ur.role = 'client'
    LEFT JOIN public.profiles p ON p.id = al.user_id
    WHERE al.created_at >= day_start AND al.created_at < day_end
    GROUP BY al.user_id, p.prenom, p.nom, p.email
    ORDER BY actions DESC LIMIT 20
  ) c;

  -- Activité par heure
  SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY (row_to_json(h)->>'hour')::int), '[]'::jsonb) INTO v_hourly FROM (
    SELECT EXTRACT(HOUR FROM (al.created_at AT TIME ZONE tz))::int AS hour,
           count(*)::int AS actions
    FROM public.audit_logs al
    WHERE al.created_at >= day_start AND al.created_at < day_end
    GROUP BY 1
    ORDER BY 1
  ) h;

  INSERT INTO public.daily_direction_reports (
    report_date, generated_by, summary_json, user_reports_json,
    pole_reports_json, client_reports_json, hourly_activity_json,
    actions_count, messages_count, documents_count, dossiers_modified_count,
    relances_count, active_users_count
  ) VALUES (
    _date, auth.uid(), v_summary, v_users, v_poles, v_clients, v_hourly,
    COALESCE(v_actions,0), COALESCE(v_msgs,0), COALESCE(v_docs,0), COALESCE(v_dossiers,0),
    COALESCE(v_relances,0), COALESCE(v_active_users,0)
  )
  ON CONFLICT (report_date) DO UPDATE SET
    generated_by = EXCLUDED.generated_by,
    summary_json = EXCLUDED.summary_json,
    user_reports_json = EXCLUDED.user_reports_json,
    pole_reports_json = EXCLUDED.pole_reports_json,
    client_reports_json = EXCLUDED.client_reports_json,
    hourly_activity_json = EXCLUDED.hourly_activity_json,
    actions_count = EXCLUDED.actions_count,
    messages_count = EXCLUDED.messages_count,
    documents_count = EXCLUDED.documents_count,
    dossiers_modified_count = EXCLUDED.dossiers_modified_count,
    relances_count = EXCLUDED.relances_count,
    active_users_count = EXCLUDED.active_users_count,
    updated_at = now()
  RETURNING id INTO rap_id;

  RETURN rap_id;
END; $$;
