ALTER TABLE public.dossiers
  ADD COLUMN IF NOT EXISTS qualiopi_audit_type TEXT,
  ADD COLUMN IF NOT EXISTS qualiopi_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS nb_stagiaires INT,
  ADD COLUMN IF NOT EXISTS nb_formateurs INT,
  ADD COLUMN IF NOT EXISTS nb_formations INT;