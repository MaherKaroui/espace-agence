
ALTER TABLE public.agency_tasks
  ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS task_type text;

CREATE INDEX IF NOT EXISTS idx_agency_tasks_dossier_type
  ON public.agency_tasks (dossier_id, task_type) WHERE task_type IS NOT NULL;

CREATE OR REPLACE FUNCTION public.auto_create_task_for_new_dossier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_assignee uuid;
  v_creator uuid;
  v_client_name text;
  v_of_name text;
  v_task_id uuid;
  v_pole_nom text;
  v_no_member boolean;
BEGIN
  -- Anti-doublon
  SELECT id INTO v_existing
  FROM public.agency_tasks
  WHERE dossier_id = NEW.id AND task_type = 'nouveau_dossier'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Assignation : manager d'abord
  SELECT pm.user_id INTO v_assignee
  FROM public.pole_members pm
  WHERE pm.pole_id = NEW.pole_id AND pm.role = 'manager'
  ORDER BY pm.created_at ASC
  LIMIT 1;

  -- Sinon consultant
  IF v_assignee IS NULL THEN
    SELECT pm.user_id INTO v_assignee
    FROM public.pole_members pm
    WHERE pm.pole_id = NEW.pole_id AND pm.role = 'consultant'
    ORDER BY pm.created_at ASC
    LIMIT 1;
  END IF;

  v_no_member := v_assignee IS NULL;

  -- Créateur = premier admin (obligatoire pour created_by)
  SELECT ur.user_id INTO v_creator
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ORDER BY ur.id ASC
  LIMIT 1;

  -- Si aucun admin, retomber sur le client (any auth.users id valide la FK)
  IF v_creator IS NULL THEN
    v_creator := NEW.client_id;
  END IF;

  -- Fallback : assigné = admin
  IF v_assignee IS NULL THEN
    v_assignee := v_creator;
  END IF;

  -- Nom client + OF pour la description
  SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.prenom, p.nom)), ''), p.email)
    INTO v_client_name
  FROM public.profiles p WHERE p.id = NEW.client_id;

  v_of_name := COALESCE(NULLIF(TRIM(NEW.organisme_nom), ''), NULL);
  SELECT nom INTO v_pole_nom FROM public.poles WHERE id = NEW.pole_id;

  INSERT INTO public.agency_tasks (
    title, description, priority, status, due_date,
    created_by, assigned_to, pole_id, client_id, dossier_id,
    auto, task_type
  ) VALUES (
    'Nouveau dossier à traiter — ' || NEW.titre,
    'Un nouveau dossier a été créé pour ' ||
      COALESCE(v_of_name, v_client_name, 'un client') ||
      '. Merci de prendre en charge le dossier.',
    'normale',
    'a_faire',
    (now() + interval '1 day'),
    v_creator,
    v_assignee,
    NEW.pole_id,
    NEW.client_id,
    NEW.id,
    true,
    'nouveau_dossier'
  ) RETURNING id INTO v_task_id;

  -- Notification in-app à l'assigné
  IF v_assignee IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (
      v_assignee,
      'agency_task',
      'Nouvelle tâche automatique',
      'Nouveau dossier à traiter — ' || NEW.titre,
      '/admin/taches-agence'
    );
  END IF;

  -- Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (
    v_creator,
    'auto_task_created',
    'dossier',
    NEW.id,
    CASE WHEN v_no_member THEN 'warning' ELSE 'info' END,
    jsonb_build_object(
      'task_id', v_task_id,
      'task_type', 'nouveau_dossier',
      'assigned_to', v_assignee,
      'pole_id', NEW.pole_id,
      'pole_nom', v_pole_nom,
      'no_pole_member', v_no_member,
      'dossier_titre', NEW.titre
    )
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_create_task_for_new_dossier() FROM anon, PUBLIC;

DROP TRIGGER IF EXISTS trg_auto_task_new_dossier ON public.dossiers;
CREATE TRIGGER trg_auto_task_new_dossier
AFTER INSERT ON public.dossiers
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_task_for_new_dossier();
