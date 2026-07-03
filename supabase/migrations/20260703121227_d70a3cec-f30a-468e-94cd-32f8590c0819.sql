
CREATE OR REPLACE FUNCTION public.auto_advance_dossier_from_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d_id uuid;
  pending int;
  accepted int;
  current_statut public.dossier_statut;
BEGIN
  d_id := COALESCE(NEW.dossier_id, OLD.dossier_id);

  SELECT count(*) FILTER (WHERE statut IN ('en_attente','a_corriger')),
         count(*) FILTER (WHERE statut = 'accepte')
    INTO pending, accepted
    FROM public.documents
   WHERE dossier_id = d_id;

  SELECT statut INTO current_statut FROM public.dossiers WHERE id = d_id;

  -- Only auto-advance from early stages, never overwrite en_cours_etude/valide/termine/refuse/annule
  IF pending = 0 AND accepted > 0
     AND current_statut IN ('en_attente','documents_manquants','a_completer') THEN
    UPDATE public.dossiers
       SET statut = 'en_cours_traitement'
     WHERE id = d_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_advance_dossier_from_documents() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auto_advance_dossier_from_documents ON public.documents;
CREATE TRIGGER trg_auto_advance_dossier_from_documents
AFTER INSERT OR UPDATE OF statut OR DELETE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.auto_advance_dossier_from_documents();
