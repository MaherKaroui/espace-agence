
-- 1) Nettoyage : retirer 'client' pour tout utilisateur qui a déjà un rôle staff
DELETE FROM public.user_roles ur
WHERE ur.role = 'client'
  AND EXISTS (
    SELECT 1 FROM public.user_roles s
    WHERE s.user_id = ur.user_id
      AND s.role IN ('admin','direction','manager','consultant')
  );

-- 2) Garde-fou : empêcher la coexistence 'client' + rôle staff
CREATE OR REPLACE FUNCTION public.enforce_role_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('admin','direction','manager','consultant') THEN
    -- Retire automatiquement le rôle client si présent
    DELETE FROM public.user_roles
     WHERE user_id = NEW.user_id AND role = 'client';
  ELSIF NEW.role = 'client' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = NEW.user_id
         AND role IN ('admin','direction','manager','consultant')
    ) THEN
      RAISE EXCEPTION 'Un membre de l''agence ne peut pas avoir le rôle client'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_role_exclusivity ON public.user_roles;
CREATE TRIGGER trg_enforce_role_exclusivity
BEFORE INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_role_exclusivity();

-- 3) Fonction utilitaire : dernière activité vue (basée sur user_sessions)
CREATE OR REPLACE FUNCTION public.get_last_activity(_user_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT MAX(COALESCE(last_seen_at, ended_at, started_at))
    FROM public.user_sessions
   WHERE user_id = _user_id;
$$;

-- 4) Désactiver un membre de l'équipe (Admin uniquement) - réutilise archived_at
CREATE OR REPLACE FUNCTION public.disable_team_member(_user_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Réservé aux administrateurs';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Vous ne pouvez pas désactiver votre propre compte';
  END IF;

  UPDATE public.profiles
     SET archived_at = COALESCE(archived_at, now()),
         archived_by = auth.uid(),
         archive_reason = COALESCE(_reason, archive_reason)
   WHERE id = _user_id;

  UPDATE public.user_sessions
     SET ended_at = COALESCE(ended_at, now()),
         duration_seconds = COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int))
   WHERE user_id = _user_id AND ended_at IS NULL;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'team.disabled', 'user', _user_id, 'warning',
          jsonb_build_object('reason', _reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.enable_team_member(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Réservé aux administrateurs';
  END IF;
  UPDATE public.profiles
     SET archived_at = NULL, archived_by = NULL, archive_reason = NULL
   WHERE id = _user_id;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'team.enabled', 'user', _user_id, 'info', '{}'::jsonb);
END;
$$;
