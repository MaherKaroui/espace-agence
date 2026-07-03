
-- Rename existing Qualiopi pole to "Qualiopi - Suivi audit"
UPDATE public.poles
SET nom = 'Qualiopi - Suivi audit',
    code = 'qualiopi_suivi',
    description = COALESCE(NULLIF(description,''), 'Suivi des audits Qualiopi (initial, surveillance, renouvellement)')
WHERE code = 'qualiopi' OR nom = 'Qualiopi';

-- Create the new "Demande Qualiopi" pole
INSERT INTO public.poles (code, nom, description, couleur, actif)
VALUES ('demande_qualiopi', 'Demande Qualiopi',
        'Constitution et dépôt des demandes de certification Qualiopi',
        '#1E2761', true)
ON CONFLICT (code) DO NOTHING;

-- Migrate existing qualiopi dossiers to "Demande Qualiopi"
UPDATE public.dossiers d
SET pole_id = (SELECT id FROM public.poles WHERE code = 'demande_qualiopi')
WHERE d.categorie = 'qualiopi';
