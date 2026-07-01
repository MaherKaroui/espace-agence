-- Enum statut tâche
CREATE TYPE public.tache_statut AS ENUM ('a_faire','en_cours','en_attente_client','bloque','termine','annule');

CREATE TABLE public.tache_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categorie public.dossier_categorie NOT NULL,
  ordre INT NOT NULL,
  titre TEXT NOT NULL,
  description TEXT,
  depends_on_ordre INT,
  cote_client BOOLEAN NOT NULL DEFAULT false,
  jours_echeance INT,
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (categorie, ordre)
);
GRANT SELECT ON public.tache_templates TO authenticated;
GRANT ALL ON public.tache_templates TO service_role;
ALTER TABLE public.tache_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tous les connectés voient les templates"
  ON public.tache_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Direction/admin gèrent les templates"
  ON public.tache_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'));

CREATE TABLE public.taches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id UUID NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  titre TEXT NOT NULL,
  description TEXT,
  statut public.tache_statut NOT NULL DEFAULT 'a_faire',
  ordre INT NOT NULL DEFAULT 0,
  depends_on_id UUID REFERENCES public.taches(id) ON DELETE SET NULL,
  assigne_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cote_client BOOLEAN NOT NULL DEFAULT false,
  verrouillee BOOLEAN NOT NULL DEFAULT false,
  date_echeance DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX taches_dossier_idx ON public.taches(dossier_id);
CREATE INDEX taches_statut_idx ON public.taches(statut);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.taches TO authenticated;
GRANT ALL ON public.taches TO service_role;
ALTER TABLE public.taches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff voit toutes les tâches"
  ON public.taches FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Client voit les tâches de ses dossiers"
  ON public.taches FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dossiers d WHERE d.id = dossier_id AND d.client_id = auth.uid()));
CREATE POLICY "Staff gère les tâches"
  ON public.taches FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER taches_set_updated_at BEFORE UPDATE ON public.taches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tache_templates_set_updated_at BEFORE UPDATE ON public.tache_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.tache_templates (categorie, ordre, titre, description, depends_on_ordre, cote_client, jours_echeance) VALUES
('qualiopi', 1, 'Réception du dossier client', 'Prise de contact et cadrage initial', NULL, false, 2),
('qualiopi', 2, 'Collecte des pièces justificatives', 'Le client dépose les preuves nécessaires', 1, true, 7),
('qualiopi', 3, 'Analyse des 7 critères Qualiopi', 'Vérification des 32 indicateurs', 2, false, 5),
('qualiopi', 4, 'Rédaction des procédures', 'Manuel qualité + fiches process', 3, false, 10),
('qualiopi', 5, 'Préparation audit blanc', 'Simulation de l''audit de certification', 4, false, 7),
('qualiopi', 6, 'Passage de l''audit officiel', 'Le client passe l''audit avec l''organisme', 5, true, 30),
('qualiopi', 7, 'Clôture du dossier', 'Envoi certificat + archivage', 6, false, 3),
('nda', 1, 'Vérification pré-requis NDA', 'Statut juridique + première convention', NULL, false, 2),
('nda', 2, 'Collecte pièces (Kbis, RIB, CV formateurs…)', NULL, 1, true, 5),
('nda', 3, 'Rédaction du dossier de déclaration', NULL, 2, false, 5),
('nda', 4, 'Dépôt DIRECCTE / DREETS', NULL, 3, false, 3),
('nda', 5, 'Suivi et obtention du NDA', NULL, 4, false, 30),
('bpf', 1, 'Récupération des données comptables', NULL, NULL, true, 5),
('bpf', 2, 'Remplissage du BPF (formulaire multi-étapes)', NULL, 1, false, 5),
('bpf', 3, 'Validation client', NULL, 2, true, 3),
('bpf', 4, 'Télétransmission', NULL, 3, false, 2),
('edof', 1, 'Création compte EDOF', NULL, NULL, false, 3),
('edof', 2, 'Paramétrage des formations sur EDOF', NULL, 1, false, 7),
('edof', 3, 'Validation Caisse des Dépôts', NULL, 2, false, 30),
('cfa', 1, 'Audit de conformité CFA', NULL, NULL, false, 7),
('cfa', 2, 'Rédaction des documents CFA', NULL, 1, false, 10),
('cfa', 3, 'Dépôt et suivi', NULL, 2, false, 30),
('vae', 1, 'Livret 1 - recevabilité', NULL, NULL, true, 10),
('vae', 2, 'Livret 2 - dossier expérience', NULL, 1, true, 60),
('vae', 3, 'Préparation passage jury', NULL, 2, false, 15),
('vae', 4, 'Passage jury', NULL, 3, true, 30);

CREATE OR REPLACE FUNCTION public.creer_taches_depuis_templates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tpl RECORD;
  new_id UUID;
  ordre_to_id JSONB := '{}'::jsonb;
  dep_id UUID;
BEGIN
  FOR tpl IN
    SELECT * FROM public.tache_templates
    WHERE categorie = NEW.categorie AND actif = true
    ORDER BY ordre ASC
  LOOP
    dep_id := NULL;
    IF tpl.depends_on_ordre IS NOT NULL THEN
      dep_id := (ordre_to_id ->> tpl.depends_on_ordre::text)::uuid;
    END IF;
    INSERT INTO public.taches (dossier_id, titre, description, ordre, depends_on_id, cote_client, verrouillee, date_echeance, statut)
    VALUES (
      NEW.id, tpl.titre, tpl.description, tpl.ordre, dep_id, tpl.cote_client,
      tpl.depends_on_ordre IS NOT NULL,
      CASE WHEN tpl.jours_echeance IS NOT NULL THEN (CURRENT_DATE + tpl.jours_echeance)::date ELSE NULL END,
      CASE WHEN tpl.depends_on_ordre IS NULL THEN 'en_cours'::tache_statut ELSE 'a_faire'::tache_statut END
    ) RETURNING id INTO new_id;
    ordre_to_id := ordre_to_id || jsonb_build_object(tpl.ordre::text, new_id::text);
  END LOOP;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_dossier_create_taches
AFTER INSERT ON public.dossiers
FOR EACH ROW EXECUTE FUNCTION public.creer_taches_depuis_templates();

CREATE OR REPLACE FUNCTION public.on_tache_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.statut = 'termine' AND (OLD.statut IS DISTINCT FROM 'termine') THEN
    NEW.completed_at := now();
    UPDATE public.taches
      SET verrouillee = false,
          statut = CASE WHEN statut = 'a_faire' THEN 'en_cours'::tache_statut ELSE statut END
      WHERE depends_on_id = NEW.id AND verrouillee = true;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_tache_before_update
BEFORE UPDATE ON public.taches
FOR EACH ROW EXECUTE FUNCTION public.on_tache_change();

CREATE OR REPLACE FUNCTION public.recalc_dossier_from_taches()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d_id UUID; total INT; done INT; waiting_client INT; in_progress INT;
  new_av INT; new_statut public.dossier_statut; current_statut public.dossier_statut;
  d_client UUID; d_titre TEXT;
BEGIN
  d_id := COALESCE(NEW.dossier_id, OLD.dossier_id);
  SELECT count(*) FILTER (WHERE statut NOT IN ('annule')),
         count(*) FILTER (WHERE statut = 'termine'),
         count(*) FILTER (WHERE statut = 'en_attente_client'),
         count(*) FILTER (WHERE statut = 'en_cours')
    INTO total, done, waiting_client, in_progress
    FROM public.taches WHERE dossier_id = d_id;
  IF total IS NULL OR total = 0 THEN RETURN COALESCE(NEW, OLD); END IF;
  new_av := ROUND((done::numeric / total::numeric) * 100)::int;
  SELECT statut, client_id, titre INTO current_statut, d_client, d_titre
    FROM public.dossiers WHERE id = d_id;
  IF done = total THEN new_statut := 'termine';
  ELSIF waiting_client > 0 THEN new_statut := 'a_completer';
  ELSIF in_progress > 0 OR done > 0 THEN new_statut := 'en_cours_traitement';
  ELSE new_statut := current_statut;
  END IF;
  UPDATE public.dossiers SET avancement = new_av, statut = new_statut WHERE id = d_id;
  IF TG_OP = 'UPDATE' AND NEW.statut = 'en_attente_client' AND OLD.statut IS DISTINCT FROM 'en_attente_client' THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (d_client, 'tache_attente', 'Action requise sur votre dossier', d_titre||' : '||NEW.titre, '/dossiers/'||d_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_tache_after_change
AFTER INSERT OR UPDATE OR DELETE ON public.taches
FOR EACH ROW EXECUTE FUNCTION public.recalc_dossier_from_taches();