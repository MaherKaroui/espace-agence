ALTER TYPE public.agency_task_status ADD VALUE IF NOT EXISTS 'en_attente';

CREATE UNIQUE INDEX IF NOT EXISTS agency_tasks_auto_unique_per_dossier
  ON public.agency_tasks (dossier_id, task_type)
  WHERE auto = true AND dossier_id IS NOT NULL AND task_type IS NOT NULL;

-- Échéances intelligentes selon le type de tâche auto
CREATE OR REPLACE FUNCTION public.agency_task_default_due(_task_type text, _from timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _task_type
    WHEN 'nouveau_dossier' THEN _from + interval '3 days'
    WHEN 'document_a_verifier' THEN _from + interval '1 day'
    WHEN 'client_sans_reponse' THEN _from + interval '3 days'
    WHEN 'dossier_bloque' THEN _from
    ELSE _from + interval '2 days'
  END
$$;

REVOKE EXECUTE ON FUNCTION public.agency_task_default_due(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_task_default_due(text, timestamptz) TO authenticated, service_role;

-- Nouvelle échéance J+3 pour les tâches auto "nouveau dossier"
CREATE OR REPLACE FUNCTION public.auto_create_task_for_new_dossier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  SELECT id INTO v_existing FROM public.agency_tasks WHERE dossier_id = NEW.id AND task_type = 'nouveau_dossier' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  SELECT pm.user_id INTO v_assignee
  FROM public.pole_members pm
  JOIN public.profiles pr ON pr.id = pm.user_id AND pr.archived_at IS NULL
  WHERE pm.pole_id = NEW.pole_id AND pm.role = 'manager'
  ORDER BY pm.created_at ASC LIMIT 1;

  IF v_assignee IS NULL THEN
    SELECT pm.user_id INTO v_assignee
    FROM public.pole_members pm
    JOIN public.profiles pr ON pr.id = pm.user_id AND pr.archived_at IS NULL
    WHERE pm.pole_id = NEW.pole_id AND pm.role = 'consultant'
    ORDER BY pm.created_at ASC LIMIT 1;
  END IF;

  v_no_member := v_assignee IS NULL;

  SELECT ur.user_id INTO v_creator
  FROM public.user_roles ur
  JOIN public.profiles pr ON pr.id = ur.user_id AND pr.archived_at IS NULL
  WHERE ur.role = 'admin'
  ORDER BY ur.id ASC LIMIT 1;

  IF v_creator IS NULL THEN v_creator := NEW.client_id; END IF;
  IF v_assignee IS NULL THEN v_assignee := v_creator; END IF;

  SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.prenom, p.nom)), ''), p.email) INTO v_client_name
  FROM public.profiles p WHERE p.id = NEW.client_id;

  v_of_name := NULLIF(TRIM(NEW.organisme_nom), '');
  SELECT nom INTO v_pole_nom FROM public.poles WHERE id = NEW.pole_id;

  INSERT INTO public.agency_tasks (title, description, priority, status, due_date, created_by, assigned_to, pole_id, client_id, dossier_id, auto, task_type)
  VALUES (
    'Nouveau dossier à traiter — ' || NEW.titre,
    'Client : ' || COALESCE(v_client_name, '—') || E'\n' || 'Organisme de formation : ' || COALESCE(v_of_name, 'Nom OF manquant') || E'\n' || 'Pôle : ' || COALESCE(v_pole_nom, '—') || E'\n\n' || 'Merci de prendre en charge le dossier sous 3 jours ouvrés.',
    'normale', 'a_faire', public.agency_task_default_due('nouveau_dossier', now()), v_creator, v_assignee, NEW.pole_id, NEW.client_id, NEW.id, true, 'nouveau_dossier'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_task_id;

  IF v_task_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT r.user_id, 'statut_change'::public.notification_type, 'Nouveau dossier dans votre pôle', NEW.titre, '/admin/dossiers/' || NEW.id
  FROM public.team_notification_recipients_for_pole(NEW.pole_id, NEW.client_id) r;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (v_creator, 'auto_task_created', 'dossier', NEW.id, CASE WHEN v_no_member THEN 'warning' ELSE 'info' END,
    jsonb_build_object('task_id', v_task_id, 'task_type', 'nouveau_dossier', 'assigned_to', v_assignee, 'pole_id', NEW.pole_id, 'pole_nom', v_pole_nom, 'no_pole_member', v_no_member, 'dossier_titre', NEW.titre, 'organisme_nom', v_of_name));
  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.auto_create_task_for_new_dossier() FROM PUBLIC, anon;

-- Clôture auto des tâches liées quand le dossier est traité/archivé
CREATE OR REPLACE FUNCTION public.close_auto_tasks_for_dossier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.statut IN ('termine','valide') OR NEW.archived_at IS NOT NULL THEN
    UPDATE public.agency_tasks
       SET status = 'terminee',
           completed_at = COALESCE(completed_at, now()),
           archived_at = COALESCE(archived_at, now()),
           updated_at = now()
     WHERE dossier_id = NEW.id
       AND auto = true
       AND archived_at IS NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.close_auto_tasks_for_dossier() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_close_auto_tasks_for_dossier ON public.dossiers;
CREATE TRIGGER trg_close_auto_tasks_for_dossier
AFTER UPDATE ON public.dossiers
FOR EACH ROW
WHEN (OLD.statut IS DISTINCT FROM NEW.statut OR OLD.archived_at IS DISTINCT FROM NEW.archived_at)
EXECUTE FUNCTION public.close_auto_tasks_for_dossier();

-- Recalage des échéances des tâches auto ouvertes
UPDATE public.agency_tasks t
   SET due_date = public.agency_task_default_due(COALESCE(t.task_type, 'nouveau_dossier'), t.created_at),
       updated_at = now()
 WHERE t.auto = true
   AND t.archived_at IS NULL
   AND t.status <> 'terminee';

-- Clôture des tâches auto dont le dossier est déjà traité
UPDATE public.agency_tasks t
   SET status = 'terminee',
       completed_at = COALESCE(t.completed_at, now()),
       archived_at = COALESCE(t.archived_at, now()),
       updated_at = now()
  FROM public.dossiers d
 WHERE t.dossier_id = d.id
   AND t.auto = true
   AND t.archived_at IS NULL
   AND (d.statut IN ('termine','valide') OR d.archived_at IS NOT NULL);
