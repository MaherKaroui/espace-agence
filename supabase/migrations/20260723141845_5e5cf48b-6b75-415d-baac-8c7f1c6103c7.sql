
-- Recipients function: all users authorized on the dossier
CREATE OR REPLACE FUNCTION public.qualiopi_dossier_recipients(_dossier uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.user_id
  FROM (
    -- Admins + Direction
    SELECT ur.user_id FROM public.user_roles ur
      WHERE ur.role IN ('admin','direction')
    UNION
    -- Pole members of the dossier's pole
    SELECT pm.user_id FROM public.pole_members pm
      JOIN public.dossiers d ON d.id = _dossier
      WHERE pm.pole_id = d.pole_id
    UNION
    -- Active external assignees on the dossier
    SELECT da.user_id FROM public.dossier_assignments da
      WHERE da.dossier_id = _dossier AND da.active = true
  ) u
  WHERE u.user_id IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.qualiopi_dossier_recipients(uuid) FROM PUBLIC, anon;

-- Helper: compute the correct link per user role
CREATE OR REPLACE FUNCTION public.qualiopi_link_for(_user uuid, _dossier uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.has_role(_user, 'auditeur'::app_role)
      OR public.has_role(_user, 'certificateur'::app_role)
      THEN '/audits/' || _dossier::text
    WHEN public.has_role(_user, 'admin'::app_role)
      OR public.has_role(_user, 'direction'::app_role)
      OR public.has_role(_user, 'manager'::app_role)
      OR public.has_role(_user, 'consultant'::app_role)
      THEN '/admin/dossiers/' || _dossier::text
    ELSE '/dossiers/' || _dossier::text
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.qualiopi_link_for(uuid, uuid) FROM PUBLIC, anon;

-- Generic helper to push notifs to all recipients (bypasses RLS via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.qualiopi_notify_all(
  _dossier uuid,
  _except uuid,
  _type notification_type,
  _titre text,
  _message text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT user_id FROM public.qualiopi_dossier_recipients(_dossier)
    WHERE (_except IS NULL OR user_id <> _except)
  LOOP
    INSERT INTO public.notifications(user_id, type, titre, message, link)
    VALUES (r.user_id, _type, _titre, _message, public.qualiopi_link_for(r.user_id, _dossier));
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qualiopi_notify_all(uuid, uuid, notification_type, text, text) FROM PUBLIC, anon;

-- Trigger: new Qualiopi request
CREATE OR REPLACE FUNCTION public.trg_qualiopi_request_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ind_num int;
  ind_lib text;
BEGIN
  SELECT numero, libelle_court INTO ind_num, ind_lib
    FROM public.qualiopi_indicators WHERE id = NEW.indicator_id;
  PERFORM public.qualiopi_notify_all(
    NEW.dossier_id,
    NEW.requested_by,
    'qualiopi_demande'::notification_type,
    'Nouvelle demande Qualiopi (Ind. ' || COALESCE(ind_num, NEW.indicator_id) || ')',
    COALESCE(ind_lib, '') || CASE WHEN NEW.message IS NOT NULL THEN ' — ' || left(NEW.message, 200) ELSE '' END
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_qualiopi_request_created ON public.qualiopi_requests;
CREATE TRIGGER trg_qualiopi_request_created
  AFTER INSERT ON public.qualiopi_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_qualiopi_request_created();

-- Trigger: document uploaded
CREATE OR REPLACE FUNCTION public.trg_qualiopi_document_uploaded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d_id uuid;
BEGIN
  SELECT dossier_id INTO d_id FROM public.qualiopi_requests WHERE id = NEW.request_id;
  IF d_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.qualiopi_notify_all(
    d_id,
    NEW.uploaded_by,
    'qualiopi_document'::notification_type,
    'Nouveau document déposé',
    NEW.filename || ' (v' || NEW.version || ')'
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_qualiopi_document_uploaded ON public.qualiopi_request_documents;
CREATE TRIGGER trg_qualiopi_document_uploaded
  AFTER INSERT ON public.qualiopi_request_documents
  FOR EACH ROW EXECUTE FUNCTION public.trg_qualiopi_document_uploaded();

-- Trigger: request reviewed (validated/refused)
CREATE OR REPLACE FUNCTION public.trg_qualiopi_request_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ind_num int;
BEGIN
  IF NEW.statut IS NOT DISTINCT FROM OLD.statut THEN RETURN NEW; END IF;
  IF NEW.statut NOT IN ('validee', 'refusee') THEN RETURN NEW; END IF;
  SELECT numero INTO ind_num FROM public.qualiopi_indicators WHERE id = NEW.indicator_id;
  IF NEW.statut = 'validee' THEN
    PERFORM public.qualiopi_notify_all(
      NEW.dossier_id,
      NEW.reviewed_by,
      'qualiopi_validation'::notification_type,
      'Pièce Qualiopi validée (Ind. ' || COALESCE(ind_num, NEW.indicator_id) || ')',
      NULL
    );
  ELSE
    PERFORM public.qualiopi_notify_all(
      NEW.dossier_id,
      NEW.reviewed_by,
      'qualiopi_refus'::notification_type,
      'Pièce Qualiopi refusée (Ind. ' || COALESCE(ind_num, NEW.indicator_id) || ')',
      COALESCE('Motif : ' || left(NEW.refus_motif, 300), NULL)
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_qualiopi_request_reviewed ON public.qualiopi_requests;
CREATE TRIGGER trg_qualiopi_request_reviewed
  AFTER UPDATE OF statut ON public.qualiopi_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_qualiopi_request_reviewed();

-- Trigger: new message in an external (audit) conversation
CREATE OR REPLACE FUNCTION public.trg_qualiopi_external_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_type text;
  d_id uuid;
BEGIN
  SELECT c.type, c.dossier_id INTO c_type, d_id
    FROM public.internal_conversations c WHERE c.id = NEW.conversation_id;
  IF c_type <> 'external' OR d_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.qualiopi_notify_all(
    d_id,
    NEW.sender_id,
    'qualiopi_message'::notification_type,
    'Nouveau message dans le canal d''audit',
    COALESCE(left(NEW.content, 200), 'Pièce jointe')
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_qualiopi_external_message ON public.internal_messages;
CREATE TRIGGER trg_qualiopi_external_message
  AFTER INSERT ON public.internal_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_qualiopi_external_message();
