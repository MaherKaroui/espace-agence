-- Nouveau client : déclenché à l'attribution du rôle client
CREATE OR REPLACE FUNCTION public.notify_new_client_team()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nom text;
  v_email text;
BEGIN
  IF NEW.role <> 'client'::public.app_role THEN
    RETURN NEW;
  END IF;

  SELECT trim(coalesce(pr.prenom,'') || ' ' || coalesce(pr.nom,'')), pr.email
    INTO v_nom, v_email
    FROM public.profiles pr WHERE pr.id = NEW.user_id;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT ur.user_id, 'compte_active'::public.notification_type,
         'Nouveau client',
         coalesce(NULLIF(v_nom,''), v_email, 'Nouveau compte') || ' vient de rejoindre IZISuivis.',
         '/admin/clients/' || NEW.user_id
  FROM public.user_roles ur
  JOIN public.profiles pr ON pr.id = ur.user_id
  WHERE ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
    AND pr.archived_at IS NULL
    AND ur.user_id <> NEW.user_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_new_client_team ON public.user_roles;
CREATE TRIGGER trg_notify_new_client_team
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.notify_new_client_team();

REVOKE EXECUTE ON FUNCTION public.notify_new_client_team() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_new_dossier_team() FROM PUBLIC, anon, authenticated;