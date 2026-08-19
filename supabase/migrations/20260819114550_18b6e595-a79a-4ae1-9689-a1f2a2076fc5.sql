-- Suppression de la vérification document par document
DROP TRIGGER IF EXISTS trg_auto_advance_dossier_from_documents ON public.documents;
DROP TRIGGER IF EXISTS trg_close_auto_task_docs_validated ON public.documents;
DROP TRIGGER IF EXISTS trg_document_status_audit ON public.documents;
DROP FUNCTION IF EXISTS public.auto_advance_dossier_from_documents();
DROP FUNCTION IF EXISTS public.close_auto_task_when_docs_validated();
DROP FUNCTION IF EXISTS public.on_document_status_audit();

-- notify_new_document : ne dépend plus du statut de vérification
CREATE OR REPLACE FUNCTION public.notify_new_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client uuid;
  v_pole_id uuid;
BEGIN
  SELECT client_id, pole_id INTO v_client, v_pole_id FROM public.dossiers WHERE id = NEW.dossier_id;
  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (v_client,
      CASE WHEN NEW.storage_path IS NULL THEN 'document_demande'::public.notification_type ELSE 'document_depose'::public.notification_type END,
      CASE WHEN NEW.storage_path IS NULL THEN 'Document demandé par l''agence' ELSE 'Nouveau document de l''agence' END,
      NEW.nom, '/dossiers/' || NEW.dossier_id);
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id, 'document_depose'::public.notification_type, 'Nouveau document', NEW.nom, '/admin/dossiers/' || NEW.dossier_id
    FROM public.team_notification_recipients_for_pole(v_pole_id, NEW.uploader_id) r;
  END IF;
  RETURN NEW;
END;
$function$;

-- Clôture d'un dossier : ne dépend plus de la validation des pièces
CREATE OR REPLACE FUNCTION public.enforce_dossier_completion_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.internal_recalc', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF NEW.avancement = 100 AND NEW.statut NOT IN ('termine','valide') THEN
    NEW.avancement := 95;
  END IF;

  RETURN NEW;
END;
$function$;

-- Avancement = étapes terminées / 3
CREATE OR REPLACE FUNCTION public.recalc_dossier_from_taches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d_id UUID; total INT; done INT; waiting_client INT; in_progress INT;
  new_av INT; new_statut public.dossier_statut; current_statut public.dossier_statut;
  d_client UUID; d_titre TEXT;
BEGIN
  d_id := COALESCE(NEW.dossier_id, OLD.dossier_id);
  SELECT count(*) FILTER (WHERE statut NOT IN ('annule')),
         count(*) FILTER (WHERE statut = 'termine'),
         count(*) FILTER (WHERE statut = 'en_attente_client'),
         count(*) FILTER (WHERE statut = 'en_cours')
    INTO total, done, waiting_client, in_progress
    FROM public.taches WHERE dossier_id = d_id;
  IF total IS NULL OR total = 0 THEN RETURN COALESCE(NEW, OLD); END IF;
  new_av := ROUND((LEAST(done, 3)::numeric / 3::numeric) * 100)::int;
  SELECT statut, client_id, titre INTO current_statut, d_client, d_titre
    FROM public.dossiers WHERE id = d_id;
  IF done >= total THEN new_statut := 'termine';
  ELSIF waiting_client > 0 THEN new_statut := 'a_completer';
  ELSIF in_progress > 0 OR done > 0 THEN new_statut := 'en_cours_traitement';
  ELSE new_statut := current_statut;
  END IF;

  PERFORM set_config('app.internal_recalc', '1', true);
  UPDATE public.dossiers SET avancement = new_av, statut = new_statut WHERE id = d_id;
  PERFORM set_config('app.internal_recalc', '', true);

  IF TG_OP = 'UPDATE' AND NEW.statut = 'en_attente_client' AND OLD.statut IS DISTINCT FROM 'en_attente_client' THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (d_client, 'tache_attente', 'Action requise sur votre dossier', d_titre||' : '||NEW.titre, '/dossiers/'||d_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;

-- Colonnes de vérification supprimées
ALTER TABLE public.documents DROP COLUMN IF EXISTS statut;
ALTER TABLE public.documents DROP COLUMN IF EXISTS commentaire;

-- Recalcul de l'avancement existant sur la base des étapes
UPDATE public.dossiers d
SET avancement = CASE
  WHEN d.statut IN ('termine','valide') THEN 100
  ELSE ROUND((LEAST(t.done, 3)::numeric / 3::numeric) * 100)::int
END
FROM (
  SELECT dossier_id, count(*) FILTER (WHERE statut = 'termine') AS done
  FROM public.taches GROUP BY dossier_id
) t
WHERE t.dossier_id = d.id;