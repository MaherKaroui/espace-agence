
-- 1. Table de suivi des rappels envoyés (dedupe)
CREATE TABLE IF NOT EXISTS public.rdv_reminders_sent (
  rdv_id uuid NOT NULL REFERENCES public.rendez_vous(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rdv_id, kind)
);

GRANT SELECT ON public.rdv_reminders_sent TO authenticated;
GRANT ALL ON public.rdv_reminders_sent TO service_role;
ALTER TABLE public.rdv_reminders_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rdv_reminders_admin_read" ON public.rdv_reminders_sent
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'direction'::app_role));

-- 2. Fonction qui envoie les rappels 24h et 1h avant les RDV confirmés
CREATE OR REPLACE FUNCTION public.send_rdv_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  d_str text;
  kind text;
  titre_client text;
  titre_admin text;
BEGIN
  -- Rappel 24h : rdv confirmé entre maintenant+23h et maintenant+25h
  FOR r IN
    SELECT rv.* FROM public.rendez_vous rv
    WHERE rv.status = 'confirme'
      AND rv.starts_at BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
      AND NOT EXISTS (SELECT 1 FROM public.rdv_reminders_sent s WHERE s.rdv_id = rv.id AND s.kind = '24h')
  LOOP
    d_str := to_char(r.starts_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY à HH24"h"MI');
    titre_client := 'Rappel : rendez-vous demain';
    titre_admin  := 'Rappel : rendez-vous client demain';

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (r.client_id, 'rdv', titre_client,
      'Votre rendez-vous est prévu le ' || d_str || '.', '/rendez-vous');

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT ur.user_id, 'rdv', titre_admin,
      'Rendez-vous prévu le ' || d_str || '.', '/admin/rendez-vous'
    FROM public.user_roles ur WHERE ur.role IN ('admin','direction');

    INSERT INTO public.rdv_reminders_sent (rdv_id, kind) VALUES (r.id, '24h')
      ON CONFLICT DO NOTHING;
  END LOOP;

  -- Rappel 1h : rdv confirmé entre maintenant+50min et maintenant+70min
  FOR r IN
    SELECT rv.* FROM public.rendez_vous rv
    WHERE rv.status = 'confirme'
      AND rv.starts_at BETWEEN (now() + interval '50 minutes') AND (now() + interval '70 minutes')
      AND NOT EXISTS (SELECT 1 FROM public.rdv_reminders_sent s WHERE s.rdv_id = rv.id AND s.kind = '1h')
  LOOP
    d_str := to_char(r.starts_at AT TIME ZONE 'Europe/Paris', 'HH24"h"MI');
    titre_client := 'Rappel : rendez-vous dans 1 heure';
    titre_admin  := 'Rappel : rendez-vous client dans 1 heure';

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (r.client_id, 'rdv', titre_client,
      'Votre rendez-vous commence à ' || d_str || '.', '/rendez-vous');

    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT ur.user_id, 'rdv', titre_admin,
      'Rendez-vous à ' || d_str || '.', '/admin/rendez-vous'
    FROM public.user_roles ur WHERE ur.role IN ('admin','direction');

    INSERT INTO public.rdv_reminders_sent (rdv_id, kind) VALUES (r.id, '1h')
      ON CONFLICT DO NOTHING;
  END LOOP;
END; $$;

REVOKE ALL ON FUNCTION public.send_rdv_reminders() FROM PUBLIC, anon, authenticated;

-- 3. Planification pg_cron toutes les 5 minutes
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-rdv-reminders') THEN
    PERFORM cron.unschedule('send-rdv-reminders');
  END IF;
END $$;

SELECT cron.schedule(
  'send-rdv-reminders',
  '*/5 * * * *',
  $$ SELECT public.send_rdv_reminders(); $$
);
