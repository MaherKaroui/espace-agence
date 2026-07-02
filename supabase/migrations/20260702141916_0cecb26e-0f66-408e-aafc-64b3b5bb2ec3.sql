ALTER TABLE public.dossiers 
  ADD COLUMN IF NOT EXISTS has_stagiaires boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stagiaires jsonb NOT NULL DEFAULT '[]'::jsonb;