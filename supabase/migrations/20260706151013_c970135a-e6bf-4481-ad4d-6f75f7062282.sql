-- Bloque le passage d'un dossier à "termine" tant que des documents restent
-- en attente / à corriger / refusés, ou qu'aucun document n'est validé.
-- Bloque aussi avancement=100 sans dossier terminé.
CREATE OR REPLACE FUNCTION public.enforce_dossier_completion_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending int;
  accepted int;
BEGIN
  -- Autoriser les recalculs internes (triggers taches/documents)
  IF current_setting('app.internal_recalc', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF NEW.statut = 'termine' AND (TG_OP = 'INSERT' OR OLD.statut IS DISTINCT FROM 'termine') THEN
    SELECT
      count(*) FILTER (WHERE statut IN ('en_attente','a_corriger','refuse')),
      count(*) FILTER (WHERE statut = 'accepte')
      INTO pending, accepted
    FROM public.documents
    WHERE dossier_id = NEW.id;

    IF pending > 0 OR accepted = 0 THEN
      RAISE EXCEPTION 'Impossible de terminer ce dossier : % document(s) non validé(s) et % accepté(s). Validez toutes les pièces avant de clore.',
        pending, accepted
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Cohérence avancement / statut
  IF NEW.avancement = 100 AND NEW.statut NOT IN ('termine','valide') THEN
    NEW.avancement := 95;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_dossier_completion ON public.dossiers;
CREATE TRIGGER trg_enforce_dossier_completion
  BEFORE INSERT OR UPDATE ON public.dossiers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dossier_completion_consistency();

REVOKE EXECUTE ON FUNCTION public.enforce_dossier_completion_consistency() FROM PUBLIC, anon;
