
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
         entreprise = NULL,
         avatar_url = NULL
   WHERE id = _user_id;

  UPDATE public.audit_logs
     SET metadata = metadata - 'ip'
   WHERE user_id = _user_id;

  UPDATE public.user_sessions
     SET ip = NULL, city = NULL, region = NULL, country = NULL, country_code = NULL,
         latitude = NULL, longitude = NULL, user_agent = NULL
   WHERE user_id = _user_id;

  UPDATE public.deletion_requests
     SET status = 'processed', processed_at = now(), processed_by = auth.uid()
   WHERE user_id = _user_id AND status = 'pending';

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'rgpd.account_anonymized', 'user', _user_id, 'warning',
          jsonb_build_object('anonymized_email', anon_email));
END; $$;
