
-- 1) Rename pole code to match the dossier categorie enum value
UPDATE public.poles SET code = 'qualiopi' WHERE code = 'demande_qualiopi';

-- 2) Create missing poles for each dossier_categorie value
INSERT INTO public.poles (code, nom, description, couleur, actif)
VALUES
  ('bpf', 'BPF', 'Bilan Pédagogique et Financier', '#6366f1', true),
  ('cfa', 'CFA', 'Centre de Formation d''Apprentis', '#f59e0b', true),
  ('vae', 'VAE', 'Validation des Acquis de l''Expérience', '#10b981', true),
  ('contrats', 'Contrats', 'Gestion des contrats', '#0ea5e9', true),
  ('documents_administratifs', 'Documents administratifs', 'Gestion des documents administratifs', '#64748b', true)
ON CONFLICT (code) DO NOTHING;
