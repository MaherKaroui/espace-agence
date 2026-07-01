CREATE OR REPLACE FUNCTION public.notify_dossier_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  statut_label TEXT;
BEGIN
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    statut_label := CASE NEW.statut::text
      WHEN 'en_attente' THEN 'En attente'
      WHEN 'documents_manquants' THEN 'Documents manquants'
      WHEN 'en_cours_etude' THEN 'En cours d''étude'
      WHEN 'en_cours_traitement' THEN 'En cours de traitement'
      WHEN 'a_completer' THEN 'À compléter'
      WHEN 'valide' THEN 'Validé'
      WHEN 'refuse' THEN 'Refusé'
      WHEN 'termine' THEN 'Terminé'
      WHEN 'annule' THEN 'Annulé'
      ELSE NEW.statut::text
    END;
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (NEW.client_id, 'statut_change', 'Statut du dossier mis à jour',
      NEW.titre || ' : ' || statut_label, '/dossiers/' || NEW.id);
  END IF;
  RETURN NEW;
END; $function$;