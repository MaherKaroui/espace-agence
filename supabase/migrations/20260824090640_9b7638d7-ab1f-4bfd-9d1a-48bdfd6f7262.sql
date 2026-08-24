CREATE TABLE public.demande_pieces_modeles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categorie public.dossier_categorie NOT NULL,
  libelle text NOT NULL,
  motif text,
  obligatoire boolean NOT NULL DEFAULT true,
  ordre integer NOT NULL DEFAULT 0,
  actif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.demande_pieces_modeles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.demande_pieces_modeles TO authenticated;
GRANT ALL ON public.demande_pieces_modeles TO service_role;

ALTER TABLE public.demande_pieces_modeles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read active models"
ON public.demande_pieces_modeles FOR SELECT TO authenticated
USING (actif OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));

CREATE POLICY "Admins manage models insert"
ON public.demande_pieces_modeles FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));

CREATE POLICY "Admins manage models update"
ON public.demande_pieces_modeles FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));

CREATE POLICY "Admins manage models delete"
ON public.demande_pieces_modeles FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));

CREATE INDEX idx_demande_pieces_modeles_cat ON public.demande_pieces_modeles (categorie, ordre);

CREATE TRIGGER trg_demande_pieces_modeles_updated_at
BEFORE UPDATE ON public.demande_pieces_modeles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.demande_pieces_modeles (categorie, libelle, motif, obligatoire, ordre) VALUES
('nda', 'Extrait Kbis ou avis de situation SIRENE (moins de 3 mois)', 'Justifie l''existence légale de la structure lors de la déclaration d''activité.', true, 1),
('nda', 'Pièce d''identité du dirigeant', 'Vérification de l''identité du représentant légal.', true, 2),
('nda', 'Premier contrat ou convention de formation signé', 'Pièce exigée pour déclencher la déclaration d''activité auprès de la DREETS.', true, 3),
('nda', 'Programme de la formation concernée', 'Complète le dossier de déclaration d''activité.', true, 4),
('nda', 'Bulletin n°3 du casier judiciaire du dirigeant', 'Demandé par la DREETS lors de l''enregistrement.', true, 5),
('nda', 'RIB de la structure', 'Utilisé pour les démarches administratives et de facturation.', false, 6),
('qualiopi', 'Organigramme et CV des formateurs', 'Preuve des compétences mobilisées (indicateurs relatifs aux moyens humains).', true, 1),
('qualiopi', 'Catalogue et programmes de formation détaillés', 'Preuve de l''information au public sur les prestations.', true, 2),
('qualiopi', 'Modèles de convention, convocation et attestation', 'Preuves du processus administratif de la prestation.', true, 3),
('qualiopi', 'Questionnaires de satisfaction et bilan des retours', 'Preuve du recueil et du traitement des appréciations.', true, 4),
('qualiopi', 'Procédure de traitement des réclamations', 'Preuve de la gestion des aléas et des réclamations.', true, 5),
('qualiopi', 'Registre des adaptations pour les publics en situation de handicap', 'Preuve de la prise en compte du public bénéficiaire.', true, 6),
('qualiopi', 'Preuves de veille légale, métier et pédagogique', 'Preuve de l''actualisation des pratiques.', true, 7),
('qualiopi', 'Plan de développement des compétences des intervenants', 'Preuve de la montée en compétences des personnels.', false, 8),
('edof', 'Attestation Qualiopi en cours de validité', 'Condition d''accès au référencement EDOF / Mon Compte Formation.', true, 1),
('edof', 'Numéro de déclaration d''activité (NDA)', 'Identifiant obligatoire du compte EDOF.', true, 2),
('edof', 'Fiche RS ou RNCP visée', 'Détermine l''éligibilité de la formation au CPF.', true, 3),
('edof', 'Descriptif de l''offre (objectifs, durée, modalités, tarif)', 'Alimente la fiche publiée sur Mon Compte Formation.', true, 4),
('edof', 'Habilitation ou partenariat avec le certificateur', 'Justifie le droit de préparer à la certification visée.', true, 5),
('edof', 'RIB et coordonnées de facturation', 'Nécessaire au paiement par la Caisse des Dépôts.', false, 6),
('juridique', 'Statuts à jour de la société', 'Base de l''analyse juridique de la structure.', true, 1),
('juridique', 'Extrait Kbis (moins de 3 mois)', 'Vérification de l''immatriculation en cours.', true, 2),
('juridique', 'Contrats ou conventions concernés par la demande', 'Pièces à analyser ou à sécuriser.', true, 3),
('juridique', 'Conditions générales de vente en vigueur', 'Contrôle de conformité contractuelle.', false, 4),
('juridique', 'Échanges ou mises en demeure liés au litige', 'Contexte nécessaire pour apprécier la situation.', false, 5);