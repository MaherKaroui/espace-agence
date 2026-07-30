-- 1) Prise en charge du dossier -> tâche auto en cours
CREATE OR REPLACE FUNCTION public.sync_auto_task_on_dossier_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.statut IN ('en_cours_etude','en_cours_traitement') THEN
    UPDATE public.agency_tasks
       SET status = 'en_cours', updated_at = now()
     WHERE dossier_id = NEW.id
       AND auto = true
       AND archived_at IS NULL
       AND status = 'a_faire';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_auto_task_on_dossier_progress() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_sync_auto_task_on_dossier_progress ON public.dossiers;
CREATE TRIGGER trg_sync_auto_task_on_dossier_progress
AFTER UPDATE OF statut ON public.dossiers
FOR EACH ROW
WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
EXECUTE FUNCTION public.sync_auto_task_on_dossier_progress();

-- 2) Tous les documents acceptés -> clôture de la tâche auto liée
CREATE OR REPLACE FUNCTION public.close_auto_task_when_docs_validated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending int;
BEGIN
  IF NEW.statut IS DISTINCT FROM 'accepte' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO pending
    FROM public.documents d
   WHERE d.dossier_id = NEW.dossier_id
     AND COALESCE(d.statut,'en_attente') <> 'accepte';

  IF pending = 0 THEN
    UPDATE public.agency_tasks
       SET status = 'terminee',
           completed_at = COALESCE(completed_at, now()),
           updated_at = now()
     WHERE dossier_id = NEW.dossier_id
       AND auto = true
       AND archived_at IS NULL
       AND status <> 'terminee';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_auto_task_when_docs_validated() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_close_auto_task_docs_validated ON public.documents;
CREATE TRIGGER trg_close_auto_task_docs_validated
AFTER UPDATE OF statut ON public.documents
FOR EACH ROW
WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
EXECUTE FUNCTION public.close_auto_task_when_docs_validated();