
-- ============================================================
-- LOT A : Fondation Qualiopi (rôles + affectations + référentiel)
-- ============================================================

-- 1) Rôles Auditeur / Certificateur
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'auditeur';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'certificateur';

-- 2) Table d'affectation
CREATE TABLE IF NOT EXISTS public.dossier_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dossier_id UUID NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('auditeur','certificateur')),
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dossier_assignments_unique_active
  ON public.dossier_assignments(dossier_id, user_id, role) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_dossier_assignments_user ON public.dossier_assignments(user_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_dossier_assignments_dossier ON public.dossier_assignments(dossier_id) WHERE active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dossier_assignments TO authenticated;
GRANT ALL ON public.dossier_assignments TO service_role;
ALTER TABLE public.dossier_assignments ENABLE ROW LEVEL SECURITY;

-- 3) Référentiel Qualiopi (7 critères + 32 indicateurs)
CREATE TABLE IF NOT EXISTS public.qualiopi_criteria (
  id INT PRIMARY KEY,
  titre TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.qualiopi_criteria TO authenticated, anon;
GRANT ALL ON public.qualiopi_criteria TO service_role;
ALTER TABLE public.qualiopi_criteria ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.qualiopi_indicators (
  id INT PRIMARY KEY,
  criterion_id INT NOT NULL REFERENCES public.qualiopi_criteria(id) ON DELETE CASCADE,
  numero INT NOT NULL,
  libelle_court TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qualiopi_indicators_crit ON public.qualiopi_indicators(criterion_id);
GRANT SELECT ON public.qualiopi_indicators TO authenticated, anon;
GRANT ALL ON public.qualiopi_indicators TO service_role;
ALTER TABLE public.qualiopi_indicators ENABLE ROW LEVEL SECURITY;

-- Policies référentiel (lecture publique)
DROP POLICY IF EXISTS "qualiopi_criteria_read" ON public.qualiopi_criteria;
CREATE POLICY "qualiopi_criteria_read" ON public.qualiopi_criteria FOR SELECT USING (true);
DROP POLICY IF EXISTS "qualiopi_indicators_read" ON public.qualiopi_indicators;
CREATE POLICY "qualiopi_indicators_read" ON public.qualiopi_indicators FOR SELECT USING (true);

-- Seed critères
INSERT INTO public.qualiopi_criteria (id, titre, description) VALUES
  (1, 'Conditions d''information du public', 'Information du public sur les prestations proposées, les délais pour y accéder et les résultats obtenus.'),
  (2, 'Identification précise des objectifs des prestations', 'Objectifs et adaptation aux publics bénéficiaires.'),
  (3, 'Adaptation aux publics bénéficiaires', 'Prise en compte des publics dans la conception et la mise en œuvre des prestations.'),
  (4, 'Adéquation des moyens pédagogiques, techniques et d''encadrement', 'Ressources mobilisées pour les prestations.'),
  (5, 'Qualification et développement des connaissances/compétences des personnels', 'Qualification des personnels et développement professionnel.'),
  (6, 'Inscription et investissement dans son environnement professionnel', 'Veille et intégration dans l''environnement socio-économique.'),
  (7, 'Recueil et prise en compte des appréciations et réclamations', 'Amélioration continue à partir des retours et réclamations.')
ON CONFLICT (id) DO NOTHING;

-- Seed 32 indicateurs
INSERT INTO public.qualiopi_indicators (id, criterion_id, numero, libelle_court, description) VALUES
  (1, 1, 1, 'Informations publiques', 'Le prestataire diffuse des informations accessibles au public sur ses prestations.'),
  (2, 1, 2, 'Indicateurs de résultats', 'Il diffuse des indicateurs de résultats adaptés à la nature des prestations et publics.'),
  (3, 1, 3, 'Certifications et VAE', 'Il informe des taux d''obtention et débouchés pour prestations certifiantes / VAE.'),
  (4, 2, 4, 'Objectifs de prestation', 'Analyse du besoin du bénéficiaire et objectifs opérationnels/évaluables.'),
  (5, 2, 5, 'Contenus/moyens et évaluation', 'Prestations avec contenus, moyens et modalités d''évaluation adaptés.'),
  (6, 2, 6, 'Positionnement à l''entrée', 'Modalités de positionnement à l''entrée.'),
  (7, 2, 7, 'Séquencement pédagogique', 'Adéquation entre objectifs, séquences pédagogiques et évaluations.'),
  (8, 3, 8, 'Modalités d''accueil', 'Modalités d''accueil, d''accompagnement et de suivi.'),
  (9, 3, 9, 'Adaptation prestation', 'Adaptation aux publics et à leurs contraintes.'),
  (10, 3, 10, 'Personnalisation parcours', 'Modalités d''individualisation et personnalisation.'),
  (11, 3, 11, 'Évaluation atteinte objectifs', 'Évaluation des acquis en cours et à la fin.'),
  (12, 3, 12, 'Engagements réciproques', 'Description et engagements réciproques prestataire/bénéficiaire.'),
  (13, 3, 13, 'Rythme et adaptations', 'Rythme, moyens adaptés et gestion des aléas.'),
  (14, 3, 14, 'Apprentissage — droits/devoirs', 'Information des apprentis (règlement, droits et devoirs).'),
  (15, 3, 15, 'Apprentissage — accompagnement', 'Accompagnement socio-professionnel et médiation en apprentissage.'),
  (16, 4, 16, 'Moyens humains/techniques', 'Moyens humains, techniques et pédagogiques adaptés.'),
  (17, 4, 17, 'Ressources pédagogiques', 'Ressources pédagogiques mises à disposition.'),
  (18, 4, 18, 'Coordination des intervenants', 'Coordination des intervenants internes/externes.'),
  (19, 4, 19, 'CFA — équipement dédié', 'Équipements dédiés en apprentissage.'),
  (20, 4, 20, 'CFA — accompagnement des maîtres', 'Accompagnement des maîtres d''apprentissage.'),
  (21, 5, 21, 'Compétences des intervenants', 'Compétences et qualifications des intervenants.'),
  (22, 5, 22, 'Développement compétences', 'Développement des compétences des intervenants.'),
  (23, 5, 23, 'Personnels dédiés handicap', 'Personnels dédiés à l''accompagnement des publics en situation de handicap.'),
  (24, 6, 24, 'Veille légale/réglementaire', 'Veille sur les évolutions légales et réglementaires du champ.'),
  (25, 6, 25, 'Veille sur les métiers', 'Veille sur les évolutions des métiers/compétences.'),
  (26, 6, 26, 'Veille pédagogique', 'Veille sur les innovations pédagogiques et technologiques.'),
  (27, 6, 27, 'Handicap — mobilisation', 'Mobilisation des expertises/outils/ressources handicap.'),
  (28, 7, 28, 'Sous-traitance/portage', 'Recours à la sous-traitance et/ou portage salarial.'),
  (29, 7, 29, 'Recueil appréciations', 'Recueil des appréciations des parties prenantes.'),
  (30, 7, 30, 'Traitement réclamations', 'Traitement des difficultés, réclamations et abandons.'),
  (31, 7, 31, 'Mesures d''amélioration', 'Mise en œuvre de mesures d''amélioration continue.'),
  (32, 7, 32, 'Certification — parties prenantes', 'Information aux parties prenantes du processus de certification.')
ON CONFLICT (id) DO NOTHING;

-- 4) Helpers SQL
CREATE OR REPLACE FUNCTION public.is_assigned_to_dossier(_user UUID, _dossier UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dossier_assignments
    WHERE dossier_id = _dossier AND user_id = _user AND active = true
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_assigned_to_dossier(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_to_dossier(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_assigned_as(_user UUID, _dossier UUID, _role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dossier_assignments
    WHERE dossier_id = _dossier AND user_id = _user AND active = true AND role = _role
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_assigned_as(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_as(UUID, UUID, TEXT) TO authenticated, service_role;

-- 5) RLS pour dossier_assignments
DROP POLICY IF EXISTS "assignments_read_scope" ON public.dossier_assignments;
CREATE POLICY "assignments_read_scope" ON public.dossier_assignments
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR user_id = auth.uid()
    OR public.dossier_in_scope(auth.uid(), dossier_id)
  );

DROP POLICY IF EXISTS "assignments_write_staff" ON public.dossier_assignments;
CREATE POLICY "assignments_write_staff" ON public.dossier_assignments
  FOR ALL USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR public.dossier_in_scope(auth.uid(), dossier_id)
  ) WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR public.dossier_in_scope(auth.uid(), dossier_id)
  );

-- 6) Étendre les policies existantes pour inclure les affectés
--    dossiers : lecture par affecté
DROP POLICY IF EXISTS "dossiers_read_assigned" ON public.dossiers;
CREATE POLICY "dossiers_read_assigned" ON public.dossiers
  FOR SELECT USING (public.is_assigned_to_dossier(auth.uid(), id));

--    documents : lecture par affecté
DROP POLICY IF EXISTS "documents_read_assigned" ON public.documents;
CREATE POLICY "documents_read_assigned" ON public.documents
  FOR SELECT USING (public.is_assigned_to_dossier(auth.uid(), dossier_id));

-- 7) Trigger updated_at
DROP TRIGGER IF EXISTS trg_dossier_assignments_updated ON public.dossier_assignments;
CREATE TRIGGER trg_dossier_assignments_updated
  BEFORE UPDATE ON public.dossier_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8) Audit log de l'affectation
CREATE OR REPLACE FUNCTION public.on_dossier_assignment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'dossier.assignment_added', 'dossier', NEW.dossier_id, 'info',
      jsonb_build_object('assigned_user', NEW.user_id, 'role', NEW.role));
  ELSIF TG_OP = 'UPDATE' AND OLD.active = true AND NEW.active = false THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
    VALUES (auth.uid(), 'dossier.assignment_revoked', 'dossier', NEW.dossier_id, 'info',
      jsonb_build_object('assigned_user', NEW.user_id, 'role', NEW.role));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_dossier_assignment_audit ON public.dossier_assignments;
CREATE TRIGGER trg_dossier_assignment_audit
  AFTER INSERT OR UPDATE ON public.dossier_assignments
  FOR EACH ROW EXECUTE FUNCTION public.on_dossier_assignment_change();
