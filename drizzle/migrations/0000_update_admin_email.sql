ALTER TABLE public.email_settings ALTER COLUMN admin_email SET DEFAULT 'izibusinessnadine@gmail.com';
CREATE OR REPLACE FUNCTION public.get_admin_email() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT admin_email FROM public.email_settings WHERE id = 1
  UNION ALL SELECT 'izibusinessnadine@gmail.com'
  LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.izi_admin_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id FROM public.profiles WHERE lower(email) = 'izibusinessnadine@gmail.com' LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.izi_admin_user_id() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  admin_emails TEXT[] := ARRAY['maherkr77@gmail.com','izibusinessnadine@gmail.com'];
BEGIN
  INSERT INTO public.profiles (id, nom, prenom, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nom',''), COALESCE(NEW.raw_user_meta_data->>'prenom',''), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  IF lower(NEW.email) = ANY(admin_emails) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'direction') ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client') ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END; $function$;