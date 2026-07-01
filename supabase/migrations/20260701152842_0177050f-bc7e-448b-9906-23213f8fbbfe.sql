-- 1) Champs supplémentaires sur profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telephone TEXT,
  ADD COLUMN IF NOT EXISTS entreprise TEXT;

-- 2) Notes internes agence
CREATE TABLE IF NOT EXISTS public.client_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  contenu TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_notes_client_id_idx ON public.client_notes(client_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_notes TO authenticated;
GRANT ALL ON public.client_notes TO service_role;

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

-- Lecture : équipe agence uniquement
CREATE POLICY "client_notes_select_staff"
ON public.client_notes FOR SELECT
TO authenticated
USING (public.is_staff(auth.uid()));

-- Création : équipe agence, l'auteur doit être l'utilisateur courant
CREATE POLICY "client_notes_insert_staff"
ON public.client_notes FOR INSERT
TO authenticated
WITH CHECK (public.is_staff(auth.uid()) AND author_id = auth.uid());

-- Édition : équipe agence, uniquement ses propres notes (sauf admin)
CREATE POLICY "client_notes_update_staff"
ON public.client_notes FOR UPDATE
TO authenticated
USING (public.is_staff(auth.uid()) AND (author_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
WITH CHECK (public.is_staff(auth.uid()));

-- Suppression : auteur ou admin
CREATE POLICY "client_notes_delete_staff"
ON public.client_notes FOR DELETE
TO authenticated
USING (public.is_staff(auth.uid()) AND (author_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_client_notes_updated_at ON public.client_notes;
CREATE TRIGGER trg_client_notes_updated_at
BEFORE UPDATE ON public.client_notes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();