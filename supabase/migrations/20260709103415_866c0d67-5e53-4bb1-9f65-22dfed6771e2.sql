-- 1) Permettre un document "déclaré manquant" par le client (sans fichier)
ALTER TABLE public.documents ALTER COLUMN storage_path DROP NOT NULL;

-- 2) Coordonnées de l'organisme de formation sur le dossier
ALTER TABLE public.dossiers
  ADD COLUMN IF NOT EXISTS organisme_email TEXT,
  ADD COLUMN IF NOT EXISTS organisme_telephone TEXT;
