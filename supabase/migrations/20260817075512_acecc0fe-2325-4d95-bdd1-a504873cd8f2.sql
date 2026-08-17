
ALTER TYPE public.dossier_statut ADD VALUE IF NOT EXISTS 'planification';
ALTER TYPE public.dossier_statut ADD VALUE IF NOT EXISTS 'audit_realise';

CREATE OR REPLACE FUNCTION public.dossier_title_from_of(_categorie text, _organisme_nom text, _juridique_type text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT upper(trim(_organisme_nom)) || ' - ' || (CASE _categorie
    WHEN 'edof' THEN 'DEMANDE EDOF'
    WHEN 'qualiopi' THEN 'DEMANDE QUALIOPI'
    WHEN 'nda' THEN 'DEMANDE NDA'
    WHEN 'bpf' THEN 'BPF ANNUEL'
    WHEN 'cfa' THEN 'DEMANDE CFA'
    WHEN 'vae' THEN 'DEMANDE VAE'
    WHEN 'contrats' THEN 'CONTRATS'
    WHEN 'documents_administratifs' THEN 'DOCUMENTS ADMINISTRATIFS'
    WHEN 'autres' THEN 'AUTRE DEMANDE'
    WHEN 'juridique' THEN 'JURIDIQUE' || CASE
      WHEN COALESCE(NULLIF(trim(_juridique_type), ''), '') <> '' THEN ' — ' || upper(trim(_juridique_type))
      ELSE ''
    END
    ELSE upper(COALESCE(NULLIF(_categorie, ''), 'DEMANDE'))
  END);
$$;
REVOKE EXECUTE ON FUNCTION public.dossier_title_from_of(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dossier_title_from_of(text, text, text) TO authenticated, service_role;

-- Ancien format, utilisé uniquement pour repérer les titres auto à renommer
CREATE OR REPLACE FUNCTION public.dossier_title_legacy(_categorie text, _organisme_nom text, _juridique_type text)
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
REVOKE EXECUTE ON FUNCTION public.dossier_title_legacy(text, text, text) FROM PUBLIC, anon, authenticated;

UPDATE public.dossiers d
SET titre = public.dossier_title_from_of(d.categorie::text, d.organisme_nom, d.juridique_type)
WHERE COALESCE(NULLIF(trim(d.organisme_nom), ''), '') <> ''
  AND d.titre = public.dossier_title_legacy(d.categorie::text, d.organisme_nom, d.juridique_type);

DROP FUNCTION public.dossier_title_legacy(text, text, text);
