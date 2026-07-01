-- Notifications sur changement de statut des rendez-vous + policies admin
CREATE OR REPLACE FUNCTION public.notify_rdv_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  d_str text := to_char(NEW.starts_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY à HH24"h"MI');
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Nouveau RDV demandé par un client → notifier admin/direction
    IF NEW.status = 'en_attente' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      SELECT ur.user_id, 'rdv',
        'Nouvelle demande de rendez-vous',
        'Créneau demandé le '||d_str,
        '/admin/rendez-vous'
      FROM public.user_roles ur WHERE ur.role IN ('admin','direction');
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirme' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.client_id, 'rdv', 'Rendez-vous accepté',
        'Votre rendez-vous du '||d_str||' est confirmé.', '/rendez-vous');
    ELSIF NEW.status = 'refuse' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.client_id, 'rdv', 'Rendez-vous refusé',
        'Votre demande du '||d_str||' a été refusée. Merci de choisir un autre créneau.', '/rendez-vous');
    ELSIF NEW.status = 'annule' THEN
      INSERT INTO public.notifications (user_id, type, titre, message, link)
      VALUES (NEW.client_id, 'rdv', 'Rendez-vous annulé',
        'Votre rendez-vous du '||d_str||' a été annulé.', '/rendez-vous');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_rdv_change ON public.rendez_vous;
CREATE TRIGGER trg_notify_rdv_change
AFTER INSERT OR UPDATE ON public.rendez_vous
FOR EACH ROW EXECUTE FUNCTION public.notify_rdv_change();

-- Permettre à l'admin/direction de mettre à jour tout RDV (accepter/refuser)
DROP POLICY IF EXISTS rendez_vous_update_admin ON public.rendez_vous;
CREATE POLICY rendez_vous_update_admin
ON public.rendez_vous FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'));