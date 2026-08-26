ALTER TABLE public.slack_canaux
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;