
ALTER TABLE public.dossier_assignments DROP CONSTRAINT IF EXISTS dossier_assignments_role_check;
ALTER TABLE public.dossier_assignments ADD CONSTRAINT dossier_assignments_role_check
  CHECK (role = ANY (ARRAY['auditeur'::text, 'certificateur'::text, 'juridique'::text]));

CREATE OR REPLACE FUNCTION public.dossier_in_scope(_user uuid, _dossier uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_user, 'admin'::app_role)
    OR public.has_role(_user, 'direction'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.dossiers d
      JOIN public.poles p ON p.id = d.pole_id
      JOIN public.pole_members pm ON pm.pole_id = d.pole_id
      WHERE d.id = _dossier
        AND p.actif = true
        AND pm.user_id = _user
        AND p.code <> 'juridique'
    )
    OR EXISTS (
      SELECT 1 FROM public.dossier_assignments a
      WHERE a.dossier_id = _dossier AND a.user_id = _user AND a.active = true
    );
$$;

CREATE OR REPLACE FUNCTION public.client_in_scope(_staff uuid, _client uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_staff, 'admin'::app_role)
    OR public.has_role(_staff, 'direction'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.dossiers d
      JOIN public.poles p ON p.id = d.pole_id
      JOIN public.pole_members pm ON pm.pole_id = d.pole_id
      WHERE d.client_id = _client
        AND p.actif = true
        AND pm.user_id = _staff
        AND p.code <> 'juridique'
    )
    OR EXISTS (
      SELECT 1
      FROM public.dossiers d
      JOIN public.dossier_assignments a ON a.dossier_id = d.id
      WHERE d.client_id = _client
        AND a.user_id = _staff
        AND a.active = true
    );
$$;

REVOKE EXECUTE ON FUNCTION public.dossier_in_scope(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dossier_in_scope(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.client_in_scope(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_in_scope(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_dossier_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _titre text;
  _should boolean := false;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.active = true THEN
    _should := true;
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.active, false) = false AND NEW.active = true THEN
    _should := true;
  END IF;

  IF _should THEN
    SELECT d.titre INTO _titre FROM public.dossiers d WHERE d.id = NEW.dossier_id;
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (
      NEW.user_id,
      'action_requise'::notification_type,
      CASE WHEN NEW.role = 'juridique'
        THEN 'IZISUIVI – Nouveau dossier juridique assigné'
        ELSE 'IZISUIVI – Nouveau dossier assigné' END,
      CASE WHEN NEW.role = 'juridique'
        THEN 'Un nouveau dossier juridique vous a été assigné : ' || COALESCE(_titre, 'dossier') || '. Merci de le consulter.'
        ELSE 'Un nouveau dossier vous a été assigné : ' || COALESCE(_titre, 'dossier') || '.' END,
      '/dossiers/' || NEW.dossier_id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_dossier_assignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_dossier_assignment ON public.dossier_assignments;
CREATE TRIGGER trg_notify_dossier_assignment
AFTER INSERT OR UPDATE ON public.dossier_assignments
FOR EACH ROW EXECUTE FUNCTION public.notify_dossier_assignment();
