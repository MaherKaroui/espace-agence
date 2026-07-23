
-- 1) Étendre l'enum
ALTER TYPE public.dossier_categorie ADD VALUE IF NOT EXISTS 'juridique';

-- 2) Colonne type juridique (texte contrôlé par trigger, pas par CHECK immutable)
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS juridique_type text;

-- 3) Fonction de titre étendue (3 args)
CREATE OR REPLACE FUNCTION public.dossier_title_from_of(_categorie text, _organisme_nom text, _juridique_type text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (CASE _categorie
    WHEN 'edof' THEN 'Dossier EDOF / CPF'
    WHEN 'qualiopi' THEN 'Demande Certification Qualiopi'
    WHEN 'nda' THEN 'Demande de NDA'
    WHEN 'bpf' THEN 'BPF annuel'
    WHEN 'cfa' THEN 'Création ou gestion CFA'
    WHEN 'vae' THEN 'VAE'
    WHEN 'contrats' THEN 'Contrats'
    WHEN 'documents_administratifs' THEN 'Documents administratifs'
    WHEN 'autres' THEN 'Autre demande'
    WHEN 'juridique' THEN 'Juridique' || CASE
      WHEN COALESCE(NULLIF(trim(_juridique_type), ''), '') <> '' THEN ' — ' || trim(_juridique_type)
      ELSE ''
    END
    ELSE COALESCE(NULLIF(_categorie, ''), 'Demande')
  END) || ' - ' || trim(_organisme_nom);
$$;
REVOKE EXECUTE ON FUNCTION public.dossier_title_from_of(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dossier_title_from_of(text, text, text) TO authenticated, service_role;

-- 4) Trigger mis à jour (valide juridique_type + utilise le nouveau titre)
CREATE OR REPLACE FUNCTION public.enforce_dossier_organisme_nom()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_auto text;
  new_auto text;
  allowed_juri text[] := ARRAY[
    'Création d''entreprise',
    'Transfert de siège social',
    'Modification d''objet social',
    'Cession de parts'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NULLIF(trim(NEW.organisme_nom), ''), '') = '' THEN
      RAISE EXCEPTION 'Nom de l''organisme de formation requis';
    END IF;
    NEW.organisme_nom := trim(NEW.organisme_nom);

    IF NEW.categorie::text = 'juridique' THEN
      IF COALESCE(NULLIF(trim(NEW.juridique_type), ''), '') = '' THEN
        RAISE EXCEPTION 'Type juridique requis pour un dossier Juridique';
      END IF;
      NEW.juridique_type := trim(NEW.juridique_type);
      IF NOT (NEW.juridique_type = ANY(allowed_juri)) THEN
        RAISE EXCEPTION 'Type juridique invalide: %', NEW.juridique_type;
      END IF;
    ELSE
      NEW.juridique_type := NULL;
    END IF;

    NEW.titre := public.dossier_title_from_of(NEW.categorie::text, NEW.organisme_nom, NEW.juridique_type);
    RETURN NEW;
  END IF;

  IF NEW.categorie::text = 'juridique' THEN
    IF COALESCE(NULLIF(trim(NEW.juridique_type), ''), '') = '' THEN
      RAISE EXCEPTION 'Type juridique requis pour un dossier Juridique';
    END IF;
    NEW.juridique_type := trim(NEW.juridique_type);
    IF NOT (NEW.juridique_type = ANY(allowed_juri)) THEN
      RAISE EXCEPTION 'Type juridique invalide: %', NEW.juridique_type;
    END IF;
  ELSE
    NEW.juridique_type := NULL;
  END IF;

  IF NEW.organisme_nom IS DISTINCT FROM OLD.organisme_nom
     OR NEW.categorie IS DISTINCT FROM OLD.categorie
     OR NEW.juridique_type IS DISTINCT FROM OLD.juridique_type THEN
    IF COALESCE(NULLIF(trim(NEW.organisme_nom), ''), '') = '' THEN
      RAISE EXCEPTION 'Nom de l''organisme de formation requis';
    END IF;
    NEW.organisme_nom := trim(NEW.organisme_nom);
    old_auto := CASE
      WHEN COALESCE(NULLIF(trim(OLD.organisme_nom), ''), '') = '' THEN NULL
      ELSE public.dossier_title_from_of(OLD.categorie::text, OLD.organisme_nom, OLD.juridique_type)
    END;
    new_auto := public.dossier_title_from_of(NEW.categorie::text, NEW.organisme_nom, NEW.juridique_type);
    IF OLD.titre IS NULL OR OLD.titre = old_auto THEN
      NEW.titre := new_auto;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_dossier_organisme_nom() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_dossier_organisme_nom ON public.dossiers;
CREATE TRIGGER trg_enforce_dossier_organisme_nom
BEFORE INSERT OR UPDATE OF organisme_nom, categorie, juridique_type ON public.dossiers
FOR EACH ROW EXECUTE FUNCTION public.enforce_dossier_organisme_nom();
