
-- Grant admin + direction to existing admin@izi-business.com user if present
DO $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE lower(email) = 'admin@izi-business.com' LIMIT 1;
  IF uid IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'direction')
      ON CONFLICT (user_id, role) DO NOTHING;
    -- Remove client role if present
    DELETE FROM public.user_roles WHERE user_id = uid AND role = 'client';
  END IF;
END $$;

-- Update handle_new_user to also auto-promote admin@izi-business.com on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  admin_emails TEXT[] := ARRAY['maherkr77@gmail.com','admin@izi-business.com'];
BEGIN
  INSERT INTO public.profiles (id, nom, prenom, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nom',''),
    COALESCE(NEW.raw_user_meta_data->>'prenom',''),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  IF lower(NEW.email) = ANY(admin_emails) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'direction')
      ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END; $function$;
