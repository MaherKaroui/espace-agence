ALTER TYPE public.dossier_categorie ADD VALUE IF NOT EXISTS 'rncp_rs';

CREATE OR REPLACE FUNCTION public.dossier_title_from_of(_categorie text, _organisme_nom text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT (CASE _categorie
    WHEN 'edof' THEN 'Dossier EDOF / CPF'
    WHEN 'qualiopi' THEN 'Demande Certification Qualiopi'
    WHEN 'nda' THEN 'Demande de NDA'
    WHEN 'bpf' THEN 'BPF annuel'
    WHEN 'cfa' THEN 'Création ou gestion CFA'
    WHEN 'vae' THEN 'VAE'
    WHEN 'rncp_rs' THEN 'Certification RNCP / RS'
    WHEN 'contrats' THEN 'Contrats'
    WHEN 'documents_administratifs' THEN 'Documents administratifs'
    WHEN 'autres' THEN 'Autre demande'
    ELSE COALESCE(NULLIF(_categorie, ''), 'Demande')
  END) || ' - ' || trim(_organisme_nom);
$function$;

CREATE OR REPLACE FUNCTION public.dossier_title_from_of(_categorie text, _organisme_nom text, _juridique_type text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT upper(trim(_organisme_nom)) || ' - ' || (CASE _categorie
    WHEN 'edof' THEN 'DEMANDE EDOF'
    WHEN 'qualiopi' THEN 'DEMANDE QUALIOPI'
    WHEN 'nda' THEN 'DEMANDE NDA'
    WHEN 'bpf' THEN 'BPF ANNUEL'
    WHEN 'cfa' THEN 'DEMANDE CFA'
    WHEN 'vae' THEN 'DEMANDE VAE'
    WHEN 'rncp_rs' THEN 'CERTIFICATION RNCP / RS'
    WHEN 'contrats' THEN 'CONTRATS'
    WHEN 'documents_administratifs' THEN 'DOCUMENTS ADMINISTRATIFS'
    WHEN 'autres' THEN 'AUTRE DEMANDE'
    WHEN 'juridique' THEN 'JURIDIQUE' || CASE
      WHEN COALESCE(NULLIF(trim(_juridique_type), ''), '') <> '' THEN ' — ' || upper(trim(_juridique_type))
      ELSE ''
    END
    ELSE upper(COALESCE(NULLIF(_categorie, ''), 'DEMANDE'))
  END);
$function$;