
-- Allow internal recalc trigger to bypass the client-side field lock
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
  new_av := ROUND((done::numeric / total::numeric) * 100)::int;
  SELECT statut, client_id, titre INTO current_statut, d_client, d_titre
    FROM public.dossiers WHERE id = d_id;
  IF done = total THEN new_statut := 'termine';
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

CREATE OR REPLACE FUNCTION public.enforce_dossier_client_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Internal recalculation (from taches/documents triggers) bypasses field lock
  IF current_setting('app.internal_recalc', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin'::public.app_role)
     OR public.has_role(auth.uid(), 'direction'::public.app_role)
     OR public.is_pole_member(auth.uid(), COALESCE(NEW.pole_id, OLD.pole_id)) THEN
    RETURN NEW;
  END IF;

  NEW.client_id          := OLD.client_id;
  NEW.pole_id            := OLD.pole_id;
  NEW.statut             := OLD.statut;
  NEW.avancement         := OLD.avancement;
  NEW.commentaire_agence := OLD.commentaire_agence;
  NEW.categorie          := OLD.categorie;

  RETURN NEW;
END;
$function$;

-- Same fix for auto_advance_dossier_from_documents
CREATE OR REPLACE FUNCTION public.auto_advance_dossier_from_documents()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF pending = 0 AND accepted > 0
     AND current_statut IN ('en_attente','documents_manquants','a_completer') THEN
    PERFORM set_config('app.internal_recalc', '1', true);
    UPDATE public.dossiers
       SET statut = 'en_cours_traitement'
     WHERE id = d_id;
    PERFORM set_config('app.internal_recalc', '', true);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Backfill: recompute avancement for all dossiers based on current taches
DO $$
DECLARE r RECORD; total INT; done INT; new_av INT;
BEGIN
  PERFORM set_config('app.internal_recalc', '1', true);
  FOR r IN SELECT id FROM public.dossiers LOOP
    SELECT count(*) FILTER (WHERE statut NOT IN ('annule')),
           count(*) FILTER (WHERE statut = 'termine')
      INTO total, done
      FROM public.taches WHERE dossier_id = r.id;
    IF total IS NOT NULL AND total > 0 THEN
      new_av := ROUND((done::numeric / total::numeric) * 100)::int;
      UPDATE public.dossiers SET avancement = new_av WHERE id = r.id;
    END IF;
  END LOOP;
  PERFORM set_config('app.internal_recalc', '', true);
END $$;
