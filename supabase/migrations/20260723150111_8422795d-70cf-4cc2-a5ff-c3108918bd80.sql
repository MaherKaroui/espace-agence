
-- 1) Extend pole_role enum
ALTER TYPE public.pole_role ADD VALUE IF NOT EXISTS 'auditeur';
ALTER TYPE public.pole_role ADD VALUE IF NOT EXISTS 'certificateur';

-- 2) Ensure system poles exist for Auditeur and Certificateur
INSERT INTO public.poles (code, nom, description, couleur, actif)
VALUES
  ('auditeur', 'Auditeur', 'Pôle des auditeurs externes', '#8b5cf6', true),
  ('certificateur', 'Certificateur', 'Pôle des certificateurs externes', '#0ea5e9', true)
ON CONFLICT (code) DO NOTHING;

-- 3) Sync trigger: when a pole_members row is added or updated, ensure the user has
--    the matching app_role in user_roles and remove the 'client' role. Removal from a
--    pôle does NOT downgrade the user (preservation of existing rights).
CREATE OR REPLACE FUNCTION public.sync_pole_member_to_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_role public.app_role;
BEGIN
  target_role := NEW.role::text::public.app_role;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.user_id, target_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- If the user gains a staff/external role, retirer le rôle client
  DELETE FROM public.user_roles
  WHERE user_id = NEW.user_id
    AND role = 'client'::public.app_role;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_pole_member_to_user_role() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_sync_pole_member_role ON public.pole_members;
CREATE TRIGGER trg_sync_pole_member_role
AFTER INSERT OR UPDATE OF role ON public.pole_members
FOR EACH ROW EXECUTE FUNCTION public.sync_pole_member_to_user_role();

-- 4) Backfill: apply the sync for existing pole_members so current data becomes consistent
DO $$
DECLARE
  m RECORD;
BEGIN
  FOR m IN SELECT user_id, role FROM public.pole_members LOOP
    INSERT INTO public.user_roles (user_id, role)
    VALUES (m.user_id, m.role::text::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = m.user_id AND role = 'client'::public.app_role;
  END LOOP;
END $$;
