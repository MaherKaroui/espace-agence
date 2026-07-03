
-- Purge automatique RGPD des logs > 12 mois
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.rgpd_purge_old_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_audit INT;
  deleted_sessions INT;
  deleted_notifs INT;
BEGIN
  DELETE FROM public.audit_logs WHERE created_at < now() - INTERVAL '12 months';
  GET DIAGNOSTICS deleted_audit = ROW_COUNT;

  DELETE FROM public.user_sessions WHERE COALESCE(ended_at, last_seen_at, started_at) < now() - INTERVAL '12 months';
  GET DIAGNOSTICS deleted_sessions = ROW_COUNT;

  DELETE FROM public.notifications WHERE created_at < now() - INTERVAL '12 months';
  GET DIAGNOSTICS deleted_notifs = ROW_COUNT;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (NULL, 'rgpd.auto_purge', 'system', NULL, 'info',
          jsonb_build_object(
            'audit_logs_deleted', deleted_audit,
            'user_sessions_deleted', deleted_sessions,
            'notifications_deleted', deleted_notifs
          ));
END;
$$;

-- Unschedule if already exists (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('rgpd-purge-old-logs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'rgpd-purge-old-logs',
  '0 3 * * *', -- tous les jours à 03:00 UTC
  $$ SELECT public.rgpd_purge_old_logs(); $$
);
