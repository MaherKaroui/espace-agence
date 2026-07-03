
-- Table des consentements (CGU, politique de confidentialité, bandeau logs)
CREATE TABLE public.consents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('cgu','privacy','logging_notice')),
  version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_consents_user ON public.consents(user_id, document_type, accepted_at DESC);

GRANT SELECT, INSERT ON public.consents TO authenticated;
GRANT ALL ON public.consents TO service_role;

ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own consents" ON public.consents
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own consents" ON public.consents
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins read all consents" ON public.consents
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Table des demandes de suppression
CREATE TABLE public.deletion_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','cancelled')),
  processed_at TIMESTAMPTZ,
  processed_by UUID,
  reason TEXT,
  admin_notes TEXT
);
CREATE UNIQUE INDEX idx_deletion_requests_pending ON public.deletion_requests(user_id) WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE ON public.deletion_requests TO authenticated;
GRANT ALL ON public.deletion_requests TO service_role;

ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own deletion requests" ON public.deletion_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users create own deletion request" ON public.deletion_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Users cancel own pending request" ON public.deletion_requests
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status IN ('pending','cancelled'));

CREATE POLICY "Admins read all deletion requests" ON public.deletion_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update deletion requests" ON public.deletion_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Notifier admin lors d'une nouvelle demande
CREATE OR REPLACE FUNCTION public.notify_new_deletion_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT ur.user_id, 'rgpd',
    'Nouvelle demande de suppression',
    'Un client a demandé la suppression de son compte.',
    '/admin/rgpd'
  FROM public.user_roles ur WHERE ur.role = 'admin';
  RETURN NEW;
END; $$;

CREATE TRIGGER on_deletion_request_insert
  AFTER INSERT ON public.deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_deletion_request();

-- Fonction d'anonymisation (SECURITY DEFINER, réservée admin)
CREATE OR REPLACE FUNCTION public.anonymize_user_account(_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  anon_email TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Réservé aux administrateurs';
  END IF;

  anon_email := 'client-supprime-' || substr(_user_id::text, 1, 8) || '@anonymized.local';

  UPDATE public.profiles
     SET nom = 'Client supprimé',
         prenom = '',
         email = anon_email,
         telephone = NULL,
         societe = NULL,
         avatar_url = NULL
   WHERE id = _user_id;

  -- Efface l'IP dans les journaux d'audit / sessions
  UPDATE public.audit_logs
     SET metadata = metadata - 'ip'
   WHERE user_id = _user_id;

  UPDATE public.user_sessions
     SET ip = NULL, city = NULL, region = NULL, country = NULL, country_code = NULL,
         latitude = NULL, longitude = NULL, user_agent = NULL
   WHERE user_id = _user_id;

  -- Marque la demande comme traitée
  UPDATE public.deletion_requests
     SET status = 'processed', processed_at = now(), processed_by = auth.uid()
   WHERE user_id = _user_id AND status = 'pending';

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'rgpd.account_anonymized', 'user', _user_id, 'warning',
          jsonb_build_object('anonymized_email', anon_email));
END; $$;

REVOKE ALL ON FUNCTION public.anonymize_user_account(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anonymize_user_account(UUID) TO authenticated;
