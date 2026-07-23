
ALTER TABLE public.dossiers
  ADD COLUMN IF NOT EXISTS responsable_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prochaine_action text,
  ADD COLUMN IF NOT EXISTS last_relance_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_dossiers_responsable_id ON public.dossiers(responsable_id);
