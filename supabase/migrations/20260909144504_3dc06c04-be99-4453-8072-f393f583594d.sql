-- 1) Push fan-out : clé interne fiable (le secret vault n'était plus lisible -> 401)
CREATE OR REPLACE FUNCTION public.trg_notify_push_fanout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := 'https://izisuivis.com/api/public/hooks/push-fanout';
  v_key text := 'W1els9KqtUwteLKnscd0oGlp7GZM5qm0DFeTfhUz';
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
      body := jsonb_build_object('notification_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.trg_notify_push_fanout() FROM PUBLIC, anon, authenticated;

-- 2) Nouveau dossier -> notifier l'équipe (pôle + admin/direction)
CREATE OR REPLACE FUNCTION public.notify_new_dossier_team()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client text;
BEGIN
  SELECT trim(coalesce(pr.prenom,'') || ' ' || coalesce(pr.nom,''))
    INTO v_client FROM public.profiles pr WHERE pr.id = NEW.client_id;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT r.user_id, 'statut_change'::public.notification_type,
         'Nouveau dossier',
         coalesce(NULLIF(NEW.titre,''), 'Dossier') ||
           CASE WHEN coalesce(v_client,'') <> '' THEN ' — ' || v_client ELSE '' END,
         '/admin/dossiers/' || NEW.id
  FROM public.team_notification_recipients_for_client(NEW.client_id, NEW.created_by) r;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_new_dossier_team ON public.dossiers;
CREATE TRIGGER trg_notify_new_dossier_team
AFTER INSERT ON public.dossiers
FOR EACH ROW EXECUTE FUNCTION public.notify_new_dossier_team();

-- 3) Nouveau client -> notifier admin/direction
CREATE OR REPLACE FUNCTION public.notify_new_client_team()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nom text := trim(coalesce(NEW.prenom,'') || ' ' || coalesce(NEW.nom,''));
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = NEW.user_id AND ur.role = 'client'::public.app_role
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT ur.user_id, 'compte_active'::public.notification_type,
         'Nouveau client',
         coalesce(NULLIF(v_nom,''), NEW.email, 'Nouveau compte') || ' vient de rejoindre IZISuivis.',
         '/admin/clients/' || NEW.user_id
  FROM public.user_roles ur
  JOIN public.profiles pr ON pr.id = ur.user_id
  WHERE ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
    AND pr.archived_at IS NULL
    AND ur.user_id <> NEW.user_id;

  RETURN NEW;
END;
$function$;