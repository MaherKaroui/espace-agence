
CREATE OR REPLACE FUNCTION public.enforce_role_exclusivity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.role IN ('admin','direction','manager','consultant','auditeur','certificateur') THEN
    -- Retire automatiquement le rôle client si présent
    DELETE FROM public.user_roles
     WHERE user_id = NEW.user_id AND role = 'client';
  ELSIF NEW.role = 'client' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = NEW.user_id
         AND role IN ('admin','direction','manager','consultant','auditeur','certificateur')
    ) THEN
      RAISE EXCEPTION 'Un intervenant agence/externe ne peut pas avoir le rôle client'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
