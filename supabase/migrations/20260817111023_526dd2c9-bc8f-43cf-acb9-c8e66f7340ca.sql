DROP POLICY IF EXISTS dossiers_insert_staff ON public.dossiers;
CREATE POLICY dossiers_insert_staff ON public.dossiers FOR INSERT TO authenticated
WITH CHECK (
  (public.is_staff(auth.uid()) OR public.is_pole_member(auth.uid(), pole_id))
  AND (pole_id IS NULL OR EXISTS (SELECT 1 FROM public.poles p WHERE p.id = dossiers.pole_id AND p.actif = true))
);

CREATE OR REPLACE FUNCTION public.enforce_dossier_client_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mapped_pole uuid;
BEGIN
  IF public.is_staff(auth.uid())
     OR public.is_pole_member(auth.uid(), NEW.pole_id) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO mapped_pole
    FROM public.poles
   WHERE actif = true AND lower(code) = lower(NEW.categorie::text)
   LIMIT 1;

  IF mapped_pole IS NULL THEN
    RAISE EXCEPTION 'Aucun pôle actif ne correspond à la catégorie %', NEW.categorie;
  END IF;

  NEW.pole_id := mapped_pole;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_dossier_client_insert() FROM anon;