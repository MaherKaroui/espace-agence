
ALTER TABLE public.dossiers
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE INDEX IF NOT EXISTS idx_dossiers_archived_at ON public.dossiers(archived_at);

CREATE OR REPLACE FUNCTION public.auto_archive_completed_dossier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.statut IN ('termine','valide') AND NEW.archived_at IS NULL THEN
    NEW.archived_at := now();
    NEW.archived_by := COALESCE(NEW.archived_by, auth.uid());
  ELSIF NEW.statut NOT IN ('termine','valide') AND NEW.archived_at IS NOT NULL THEN
    -- If it's reopened, unarchive it
    NEW.archived_at := NULL;
    NEW.archived_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_archive_completed_dossier() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_auto_archive_completed_dossier ON public.dossiers;
CREATE TRIGGER trg_auto_archive_completed_dossier
BEFORE INSERT OR UPDATE OF statut ON public.dossiers
FOR EACH ROW EXECUTE FUNCTION public.auto_archive_completed_dossier();

-- Backfill: archive all dossiers already terminated
UPDATE public.dossiers
SET archived_at = COALESCE(updated_at, now())
WHERE statut IN ('termine','valide') AND archived_at IS NULL;
