
ALTER TABLE public.slack_canaux
  ADD COLUMN IF NOT EXISTS collecte_selection boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collecte_cursor text,
  ADD COLUMN IF NOT EXISTS collecte_terminee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collecte_messages integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collecte_erreur text,
  ADD COLUMN IF NOT EXISTS collecte_last_at timestamptz;

ALTER TABLE public.slack_imports
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'archive';

CREATE INDEX IF NOT EXISTS slack_imports_mode_statut_idx ON public.slack_imports (mode, statut);

DO $$
DECLARE tok text;
BEGIN
  SELECT substring(command from 'Bearer ([^'']+)') INTO tok
  FROM cron.job WHERE jobname = 'purge-ephemeral-messages' LIMIT 1;
  IF tok IS NULL THEN RETURN; END IF;
  BEGIN PERFORM cron.unschedule('izisuivis-slack-robot'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule(
    'izisuivis-slack-robot',
    '* * * * *',
    format($f$SELECT net.http_post(
      url := 'https://project--51e3d791-7911-46e0-8fee-3de01cd0ad09.lovable.app/api/public/hooks/slack-robot',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
      body := '{}'::jsonb
    );$f$, tok)
  );
END $$;
