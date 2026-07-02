CREATE OR REPLACE FUNCTION public.enforce_dossier_client_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::public.app_role)
     OR public.has_role(auth.uid(), 'direction'::public.app_role)
     OR public.is_pole_member(auth.uid(), COALESCE(NEW.pole_id, OLD.pole_id)) THEN
    RETURN NEW;
  END IF;

  IF NEW.client_id     IS DISTINCT FROM OLD.client_id
     OR NEW.pole_id            IS DISTINCT FROM OLD.pole_id
     OR NEW.statut             IS DISTINCT FROM OLD.statut
     OR NEW.avancement         IS DISTINCT FROM OLD.avancement
     OR NEW.commentaire_agence IS DISTINCT FROM OLD.commentaire_agence
     OR NEW.categorie          IS DISTINCT FROM OLD.categorie THEN
    RAISE EXCEPTION 'Ce champ ne peut être modifié que par l''agence.';
  END IF;

  RETURN NEW;
END;
$function$;