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

  -- Non-agency users: silently keep protected fields at their previous values
  NEW.client_id          := OLD.client_id;
  NEW.pole_id            := OLD.pole_id;
  NEW.statut             := OLD.statut;
  NEW.avancement         := OLD.avancement;
  NEW.commentaire_agence := OLD.commentaire_agence;
  NEW.categorie          := OLD.categorie;

  RETURN NEW;
END;
$function$;