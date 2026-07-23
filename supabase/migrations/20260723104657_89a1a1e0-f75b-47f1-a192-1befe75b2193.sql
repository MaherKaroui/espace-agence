CREATE OR REPLACE FUNCTION public.dossier_title_from_of(_categorie text, _organisme_nom text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (CASE _categorie
    WHEN 'edof' THEN 'Dossier EDOF / CPF'
    WHEN 'qualiopi' THEN 'Demande Certification Qualiopi'
    WHEN 'nda' THEN 'Demande de NDA'
    WHEN 'bpf' THEN 'BPF annuel'
    WHEN 'cfa' THEN 'Création ou gestion CFA'
    WHEN 'vae' THEN 'VAE'
    WHEN 'contrats' THEN 'Contrats'
    WHEN 'documents_administratifs' THEN 'Documents administratifs'
    WHEN 'autres' THEN 'Autre demande'
    ELSE COALESCE(NULLIF(_categorie, ''), 'Demande')
  END) || ' - ' || trim(_organisme_nom);
$$;

REVOKE EXECUTE ON FUNCTION public.dossier_title_from_of(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dossier_title_from_of(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_dossier_organisme_nom()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_auto text;
  new_auto text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NULLIF(trim(NEW.organisme_nom), ''), '') = '' THEN
      RAISE EXCEPTION 'Nom de l''organisme de formation requis';
    END IF;
    NEW.organisme_nom := trim(NEW.organisme_nom);
    NEW.titre := public.dossier_title_from_of(NEW.categorie::text, NEW.organisme_nom);
    RETURN NEW;
  END IF;

  IF NEW.organisme_nom IS DISTINCT FROM OLD.organisme_nom OR NEW.categorie IS DISTINCT FROM OLD.categorie THEN
    IF COALESCE(NULLIF(trim(NEW.organisme_nom), ''), '') = '' THEN
      RAISE EXCEPTION 'Nom de l''organisme de formation requis';
    END IF;
    NEW.organisme_nom := trim(NEW.organisme_nom);
    old_auto := CASE
      WHEN COALESCE(NULLIF(trim(OLD.organisme_nom), ''), '') = '' THEN NULL
      ELSE public.dossier_title_from_of(OLD.categorie::text, OLD.organisme_nom)
    END;
    new_auto := public.dossier_title_from_of(NEW.categorie::text, NEW.organisme_nom);
    IF OLD.titre IS NULL OR OLD.titre = old_auto OR OLD.titre = public.dossier_title_from_of(NEW.categorie::text, NEW.organisme_nom) THEN
      NEW.titre := new_auto;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_dossier_organisme_nom() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_dossier_organisme_nom ON public.dossiers;
CREATE TRIGGER trg_enforce_dossier_organisme_nom
BEFORE INSERT OR UPDATE OF organisme_nom, categorie ON public.dossiers
FOR EACH ROW EXECUTE FUNCTION public.enforce_dossier_organisme_nom();

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (NEW.client_id, 'message', 'Nouveau message de l''agence', LEFT(COALESCE(NEW.content,'Pièce jointe'),140), '/messages');
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT DISTINCT recipient_id, 'message'::public.notification_type, 'Nouveau message client', LEFT(COALESCE(NEW.content,'Pièce jointe'),140), '/admin/messages/'||NEW.client_id
    FROM (
      SELECT pm.user_id AS recipient_id
      FROM public.dossiers d
      JOIN public.poles p ON p.id = d.pole_id AND p.actif = true
      JOIN public.pole_members pm ON pm.pole_id = d.pole_id
      WHERE d.client_id = NEW.client_id
      UNION
      SELECT ur.user_id AS recipient_id
      FROM public.user_roles ur
      WHERE ur.role IN ('admin','direction')
    ) r
    WHERE recipient_id IS NOT NULL AND recipient_id <> NEW.sender_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_new_message() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_new_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
BEGIN
  SELECT client_id INTO v_client FROM public.dossiers WHERE id = NEW.dossier_id;

  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (
      v_client,
      CASE WHEN NEW.storage_path IS NULL AND COALESCE(NEW.statut::text, '') = 'en_attente' THEN 'document_demande'::public.notification_type ELSE 'document_depose'::public.notification_type END,
      CASE WHEN NEW.storage_path IS NULL AND COALESCE(NEW.statut::text, '') = 'en_attente' THEN 'Document demandé par l''agence' ELSE 'Nouveau document de l''agence' END,
      NEW.nom,
      '/dossiers/'||NEW.dossier_id
    );
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT DISTINCT recipient_id, 'document_depose'::public.notification_type, 'Nouveau document déposé', NEW.nom, '/dossiers/'||NEW.dossier_id
    FROM (
      SELECT pm.user_id AS recipient_id
      FROM public.dossiers d
      JOIN public.poles p ON p.id = d.pole_id AND p.actif = true
      JOIN public.pole_members pm ON pm.pole_id = d.pole_id
      WHERE d.id = NEW.dossier_id
      UNION
      SELECT ur.user_id AS recipient_id
      FROM public.user_roles ur
      WHERE ur.role IN ('admin','direction')
    ) r
    WHERE recipient_id IS NOT NULL AND recipient_id <> NEW.uploader_id;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_new_document() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.on_document_status_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
  v_dossier_titre text;
BEGIN
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(),
      CASE NEW.statut WHEN 'accepte' THEN 'document.validated' WHEN 'refuse' THEN 'document.rejected' ELSE 'document.status_changed' END,
      'document', NEW.id, 'info',
      jsonb_build_object('dossier_id', NEW.dossier_id, 'nom', NEW.nom, 'old', OLD.statut, 'new', NEW.statut));

    IF NEW.statut::text IN ('accepte','refuse','a_corriger') THEN
      SELECT d.client_id, d.titre INTO v_client, v_dossier_titre
      FROM public.dossiers d WHERE d.id = NEW.dossier_id;

      IF v_client IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, titre, message, link)
        VALUES (
          v_client,
          CASE WHEN NEW.statut::text = 'accepte' THEN 'document_valide'::public.notification_type ELSE 'document_refuse'::public.notification_type END,
          CASE WHEN NEW.statut::text = 'accepte' THEN 'Document validé' ELSE 'Document à corriger' END,
          COALESCE(v_dossier_titre || ' · ', '') || NEW.nom,
          '/dossiers/' || NEW.dossier_id
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.on_document_status_audit() FROM PUBLIC, anon, authenticated;

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
  SELECT id INTO v_existing
  FROM public.agency_tasks
  WHERE dossier_id = NEW.id AND task_type = 'nouveau_dossier'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT pm.user_id INTO v_assignee
  FROM public.pole_members pm
  WHERE pm.pole_id = NEW.pole_id AND pm.role = 'manager'
  ORDER BY pm.created_at ASC
  LIMIT 1;

  IF v_assignee IS NULL THEN
    SELECT pm.user_id INTO v_assignee
    FROM public.pole_members pm
    WHERE pm.pole_id = NEW.pole_id AND pm.role = 'consultant'
    ORDER BY pm.created_at ASC
    LIMIT 1;
  END IF;

  v_no_member := v_assignee IS NULL;

  SELECT ur.user_id INTO v_creator
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ORDER BY ur.id ASC
  LIMIT 1;

  IF v_creator IS NULL THEN
    v_creator := NEW.client_id;
  END IF;

  IF v_assignee IS NULL THEN
    v_assignee := v_creator;
  END IF;

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
    'Client : ' || COALESCE(v_client_name, '—') || E'\n' ||
    'Organisme de formation : ' || COALESCE(v_of_name, '—') || E'\n' ||
    'Pôle : ' || COALESCE(v_pole_nom, '—') || E'\n\n' ||
    'Merci de prendre en charge le dossier sous 24h.',
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

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT DISTINCT recipient_id, 'statut_change'::public.notification_type,
    'Nouveau dossier dans votre pôle',
    NEW.titre,
    '/dossiers/' || NEW.id
  FROM (
    SELECT pm.user_id AS recipient_id
    FROM public.pole_members pm
    WHERE pm.pole_id = NEW.pole_id
    UNION
    SELECT ur.user_id AS recipient_id
    FROM public.user_roles ur
    WHERE ur.role IN ('admin','direction')
  ) r
  WHERE recipient_id IS NOT NULL AND recipient_id <> NEW.client_id;

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
      'dossier_titre', NEW.titre,
      'organisme_nom', v_of_name
    )
  );

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.auto_create_task_for_new_dossier() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_notify_push_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text := 'https://izisuivis.com/api/public/hooks/push-fanout';
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object('notification_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_notify_push_fanout() FROM PUBLIC, anon, authenticated;