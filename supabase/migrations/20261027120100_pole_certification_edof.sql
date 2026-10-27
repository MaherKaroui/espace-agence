-- =====================================================================
-- Module « Pôle Certification & EDOF »
-- Migration purement additive : nouvelles tables pc_*, nouvelles fonctions,
-- nouveau bucket, nouveau cron. Aucune table existante n'est modifiée.
-- Rollback : DROP TABLE public.pc_* CASCADE ; DROP FUNCTION public.pc_* ;
--            SELECT cron.unschedule('pc-reminders') ; bucket 'pole-certification'.
-- =====================================================================

-- ---------- Paramétrage : étapes types ----------
CREATE TABLE IF NOT EXISTS public.pc_etape_modeles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_type text NOT NULL CHECK (dossier_type IN ('certificateur','edof')),
  ordre int NOT NULL,
  intitule text NOT NULL CHECK (length(trim(intitule)) > 0),
  a_saisir text,                                   -- aide : ce qu'il faut saisir / joindre
  relance_jours int CHECK (relance_jours IS NULL OR relance_jours > 0),          -- relance si « en attente » sans réponse
  en_cours_max_jours int CHECK (en_cours_max_jours IS NULL OR en_cours_max_jours > 0), -- rappel si « en cours » trop longtemps
  event_kind text CHECK (event_kind IN ('visio','webinaire')),                    -- RDV daté : rappel veille + 1 h
  lien_expiration boolean NOT NULL DEFAULT false,  -- champ « expiration du lien / code CDC »
  bloque_si_piece_perimee boolean NOT NULL DEFAULT false,
  collecte_pieces boolean NOT NULL DEFAULT false,  -- étape de collecte : check-list des pièces
  checklist text[] NOT NULL DEFAULT '{}',          -- cases à cocher (blocs remplis, prérequis…)
  email_actif boolean NOT NULL DEFAULT true,       -- canal mail en plus de la notification
  actif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Paramétrage : types de pièces ----------
CREATE TABLE IF NOT EXISTS public.pc_piece_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  libelle text NOT NULL,
  aide text,
  validite_jours int CHECK (validite_jours IS NULL OR validite_jours > 0), -- NULL = pas de péremption
  dossier_types text[] NOT NULL DEFAULT '{edof}',
  obligatoire boolean NOT NULL DEFAULT false,
  ordre int NOT NULL DEFAULT 0,
  actif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Dossiers ----------
CREATE TABLE IF NOT EXISTS public.pc_dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('certificateur','edof')),
  titre text NOT NULL CHECK (length(trim(titre)) > 0),  -- nom de la certification ou de l'organisme
  organisme text,
  certificateur text,
  code_rs text,
  responsable_id uuid NOT NULL REFERENCES public.profiles(id),
  date_cible date,
  notes text,
  parent_id uuid REFERENCES public.pc_dossiers(id) ON DELETE SET NULL, -- EDOF créé depuis un dossier certificateur
  archived_at timestamptz,
  archived_by uuid REFERENCES public.profiles(id),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pc_dossiers_responsable_idx ON public.pc_dossiers (responsable_id);

CREATE TABLE IF NOT EXISTS public.pc_membres (
  dossier_id uuid NOT NULL REFERENCES public.pc_dossiers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'collaborateur' CHECK (role IN ('collaborateur','lecture')),
  added_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dossier_id, user_id)
);

-- ---------- Étapes (une ligne par tentative) ----------
CREATE TABLE IF NOT EXISTS public.pc_etapes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES public.pc_dossiers(id) ON DELETE CASCADE,
  groupe uuid NOT NULL DEFAULT gen_random_uuid(),  -- identique pour toutes les tentatives d'une même étape
  ordre int NOT NULL,
  intitule text NOT NULL CHECK (length(trim(intitule)) > 0),
  tentative int NOT NULL DEFAULT 1,
  remplacee boolean NOT NULL DEFAULT false,         -- true = ancienne tentative (conservée dans l'historique)
  statut text NOT NULL DEFAULT 'a_faire'
    CHECK (statut IN ('a_faire','en_cours','en_attente','valide','refuse','recours','a_recommencer')),
  date_debut date,
  date_echeance date,
  date_realisation date,
  responsable_id uuid REFERENCES public.profiles(id),
  notes text,                                       -- champ libre
  motif_refus text,
  date_limite_recours date,
  a_saisir text,
  relance_jours int,
  en_cours_max_jours int,
  event_kind text CHECK (event_kind IN ('visio','webinaire')),
  event_at timestamptz,
  lien_expiration boolean NOT NULL DEFAULT false,
  lien_expire_at timestamptz,
  bloque_si_piece_perimee boolean NOT NULL DEFAULT false,
  collecte_pieces boolean NOT NULL DEFAULT false,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { "libellé": true/false }
  email_actif boolean NOT NULL DEFAULT true,
  rappel_reporte_jusqua timestamptz,
  envoye_at timestamptz,
  statut_change_at timestamptz NOT NULL DEFAULT now(),
  force_motif text,
  force_par uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (groupe, tentative),
  CONSTRAINT pc_etapes_motif_refus CHECK (statut <> 'refuse' OR coalesce(trim(motif_refus), '') <> '')
);
CREATE INDEX IF NOT EXISTS pc_etapes_dossier_idx ON public.pc_etapes (dossier_id, ordre);
CREATE INDEX IF NOT EXISTS pc_etapes_echeance_idx ON public.pc_etapes (date_echeance) WHERE NOT remplacee;

-- ---------- Pièces (avec date d'émission et péremption) ----------
CREATE TABLE IF NOT EXISTS public.pc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES public.pc_dossiers(id) ON DELETE CASCADE,
  piece_type_id uuid REFERENCES public.pc_piece_types(id) ON DELETE SET NULL,
  nom text NOT NULL CHECK (length(trim(nom)) > 0),
  date_emission date,
  validite_jours int CHECK (validite_jours IS NULL OR validite_jours > 0),
  date_peremption date GENERATED ALWAYS AS (date_emission + validite_jours) STORED,
  etapes uuid[] NOT NULL DEFAULT '{}',               -- groupes d'étapes où la pièce est utilisée
  version int NOT NULL DEFAULT 0,
  current_fichier_id uuid,
  rappel_reporte_jusqua timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pc_documents_dossier_idx ON public.pc_documents (dossier_id);

-- ---------- Fichiers (pièces jointes d'étape + versions des pièces) ----------
CREATE TABLE IF NOT EXISTS public.pc_fichiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES public.pc_dossiers(id) ON DELETE CASCADE,
  etape_id uuid REFERENCES public.pc_etapes(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.pc_documents(id) ON DELETE CASCADE,
  version int,
  date_emission date,
  storage_path text NOT NULL UNIQUE,
  filename text NOT NULL,
  mime_type text,
  file_size bigint,
  uploaded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pc_fichiers_dossier_idx ON public.pc_fichiers (dossier_id);

-- ---------- Historique (append-only) ----------
CREATE TABLE IF NOT EXISTS public.pc_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES public.pc_dossiers(id) ON DELETE CASCADE,
  etape_id uuid,
  actor_id uuid DEFAULT auth.uid(),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pc_evenements_dossier_idx ON public.pc_evenements (dossier_id, created_at);

-- ---------- Anti-doublon des rappels envoyés ----------
CREATE TABLE IF NOT EXISTS public.pc_rappels_envoyes (
  kind text NOT NULL,
  entity_id uuid NOT NULL,
  cle text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, entity_id, cle)
);

-- =====================================================================
-- Droits
-- =====================================================================
CREATE OR REPLACE FUNCTION public.pc_is_admin(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user, 'admin'::app_role) OR public.has_role(_user, 'direction'::app_role);
$$;

-- Lecture : admin/direction, responsable, créateur, membre affecté, membre des pôles Certification / EDOF.
CREATE OR REPLACE FUNCTION public.pc_can_read(_user uuid, _dossier uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.pc_is_admin(_user)
    OR EXISTS (SELECT 1 FROM public.pc_dossiers d WHERE d.id = _dossier AND (d.responsable_id = _user OR d.created_by = _user))
    OR EXISTS (SELECT 1 FROM public.pc_membres m WHERE m.dossier_id = _dossier AND m.user_id = _user)
    OR EXISTS (SELECT 1 FROM public.pole_members pm JOIN public.poles p ON p.id = pm.pole_id
               WHERE pm.user_id = _user AND p.code IN ('certification','edof'));
$$;

-- Écriture : dossier non archivé ET (admin/direction, responsable ou collaborateur affecté).
CREATE OR REPLACE FUNCTION public.pc_can_write(_user uuid, _dossier uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.pc_dossiers d WHERE d.id = _dossier AND d.archived_at IS NULL)
    AND (public.pc_is_admin(_user)
      OR EXISTS (SELECT 1 FROM public.pc_dossiers d WHERE d.id = _dossier AND d.responsable_id = _user)
      OR EXISTS (SELECT 1 FROM public.pc_membres m WHERE m.dossier_id = _dossier AND m.user_id = _user AND m.role = 'collaborateur'));
$$;

-- Accès au module (navigation) : staff ou membre d'au moins un dossier.
CREATE OR REPLACE FUNCTION public.pc_has_access(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_staff(_user) OR EXISTS (SELECT 1 FROM public.pc_membres m WHERE m.user_id = _user);
$$;

CREATE OR REPLACE FUNCTION public.pc_admin_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('admin'::app_role, 'direction'::app_role);
$$;

-- Le premier segment du chemin Storage est l'id du dossier.
CREATE OR REPLACE FUNCTION public.pc_path_dossier(_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN split_part(_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN split_part(_name, '/', 1)::uuid END;
$$;

GRANT SELECT ON public.pc_etape_modeles, public.pc_piece_types TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pc_etape_modeles, public.pc_piece_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pc_dossiers, public.pc_membres, public.pc_etapes, public.pc_documents TO authenticated;
GRANT SELECT, INSERT ON public.pc_fichiers, public.pc_evenements TO authenticated;
GRANT ALL ON public.pc_etape_modeles, public.pc_piece_types, public.pc_dossiers, public.pc_membres, public.pc_etapes,
  public.pc_documents, public.pc_fichiers, public.pc_evenements, public.pc_rappels_envoyes TO service_role;

ALTER TABLE public.pc_etape_modeles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_piece_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_dossiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_membres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_etapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_fichiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_evenements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_rappels_envoyes ENABLE ROW LEVEL SECURITY; -- service_role uniquement

-- Paramétrage : lecture module, écriture admin/direction.
DROP POLICY IF EXISTS pc_etape_modeles_read ON public.pc_etape_modeles;
CREATE POLICY pc_etape_modeles_read ON public.pc_etape_modeles FOR SELECT TO authenticated USING (public.pc_has_access(auth.uid()));
DROP POLICY IF EXISTS pc_etape_modeles_admin ON public.pc_etape_modeles;
CREATE POLICY pc_etape_modeles_admin ON public.pc_etape_modeles FOR ALL TO authenticated
  USING (public.pc_is_admin(auth.uid())) WITH CHECK (public.pc_is_admin(auth.uid()));
DROP POLICY IF EXISTS pc_piece_types_read ON public.pc_piece_types;
CREATE POLICY pc_piece_types_read ON public.pc_piece_types FOR SELECT TO authenticated USING (public.pc_has_access(auth.uid()));
DROP POLICY IF EXISTS pc_piece_types_admin ON public.pc_piece_types;
CREATE POLICY pc_piece_types_admin ON public.pc_piece_types FOR ALL TO authenticated
  USING (public.pc_is_admin(auth.uid())) WITH CHECK (public.pc_is_admin(auth.uid()));

-- Dossiers
DROP POLICY IF EXISTS pc_dossiers_read ON public.pc_dossiers;
-- Tests directs sur la ligne en plus de pc_can_read : la fonction ne voit pas une ligne en cours d'INSERT … RETURNING.
CREATE POLICY pc_dossiers_read ON public.pc_dossiers FOR SELECT TO authenticated
  USING (responsable_id = auth.uid() OR created_by = auth.uid() OR public.pc_can_read(auth.uid(), id));
DROP POLICY IF EXISTS pc_dossiers_insert ON public.pc_dossiers;
CREATE POLICY pc_dossiers_insert ON public.pc_dossiers FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND created_by = auth.uid() AND archived_at IS NULL
              AND (responsable_id = auth.uid() OR public.pc_is_admin(auth.uid())));
DROP POLICY IF EXISTS pc_dossiers_update ON public.pc_dossiers;
CREATE POLICY pc_dossiers_update ON public.pc_dossiers FOR UPDATE TO authenticated
  USING (public.pc_is_admin(auth.uid()) OR public.pc_can_write(auth.uid(), id))
  WITH CHECK (public.pc_is_admin(auth.uid()) OR (archived_at IS NULL AND public.pc_can_write(auth.uid(), id)));
DROP POLICY IF EXISTS pc_dossiers_delete ON public.pc_dossiers;
CREATE POLICY pc_dossiers_delete ON public.pc_dossiers FOR DELETE TO authenticated USING (public.pc_is_admin(auth.uid()));

-- Membres : lecture si lecture dossier ; gestion par admin ou responsable.
DROP POLICY IF EXISTS pc_membres_read ON public.pc_membres;
CREATE POLICY pc_membres_read ON public.pc_membres FOR SELECT TO authenticated USING (public.pc_can_read(auth.uid(), dossier_id));
DROP POLICY IF EXISTS pc_membres_write ON public.pc_membres;
CREATE POLICY pc_membres_write ON public.pc_membres FOR ALL TO authenticated
  USING (public.pc_is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.pc_dossiers d WHERE d.id = dossier_id AND d.responsable_id = auth.uid() AND d.archived_at IS NULL))
  WITH CHECK (public.pc_is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.pc_dossiers d WHERE d.id = dossier_id AND d.responsable_id = auth.uid() AND d.archived_at IS NULL));

-- Étapes
DROP POLICY IF EXISTS pc_etapes_read ON public.pc_etapes;
CREATE POLICY pc_etapes_read ON public.pc_etapes FOR SELECT TO authenticated USING (public.pc_can_read(auth.uid(), dossier_id));
DROP POLICY IF EXISTS pc_etapes_insert ON public.pc_etapes;
CREATE POLICY pc_etapes_insert ON public.pc_etapes FOR INSERT TO authenticated WITH CHECK (public.pc_can_write(auth.uid(), dossier_id));
DROP POLICY IF EXISTS pc_etapes_update ON public.pc_etapes;
CREATE POLICY pc_etapes_update ON public.pc_etapes FOR UPDATE TO authenticated
  USING (public.pc_can_write(auth.uid(), dossier_id)) WITH CHECK (public.pc_can_write(auth.uid(), dossier_id));
-- Suppression : jamais une tentative refusée / en recours / remplacée (traçabilité).
DROP POLICY IF EXISTS pc_etapes_delete ON public.pc_etapes;
CREATE POLICY pc_etapes_delete ON public.pc_etapes FOR DELETE TO authenticated
  USING (public.pc_can_write(auth.uid(), dossier_id)
         AND NOT EXISTS (SELECT 1 FROM public.pc_etapes e2 WHERE e2.groupe = pc_etapes.groupe
                         AND (e2.statut IN ('refuse','recours','a_recommencer') OR e2.tentative > 1)));

-- Pièces
DROP POLICY IF EXISTS pc_documents_read ON public.pc_documents;
CREATE POLICY pc_documents_read ON public.pc_documents FOR SELECT TO authenticated USING (public.pc_can_read(auth.uid(), dossier_id));
DROP POLICY IF EXISTS pc_documents_write ON public.pc_documents;
CREATE POLICY pc_documents_write ON public.pc_documents FOR INSERT TO authenticated WITH CHECK (public.pc_can_write(auth.uid(), dossier_id));
DROP POLICY IF EXISTS pc_documents_update ON public.pc_documents;
CREATE POLICY pc_documents_update ON public.pc_documents FOR UPDATE TO authenticated
  USING (public.pc_can_write(auth.uid(), dossier_id)) WITH CHECK (public.pc_can_write(auth.uid(), dossier_id));
DROP POLICY IF EXISTS pc_documents_delete ON public.pc_documents;
CREATE POLICY pc_documents_delete ON public.pc_documents FOR DELETE TO authenticated
  USING (public.pc_is_admin(auth.uid()) AND public.pc_can_write(auth.uid(), dossier_id));

-- Fichiers : jamais modifiés ni supprimés (versions conservées).
DROP POLICY IF EXISTS pc_fichiers_read ON public.pc_fichiers;
CREATE POLICY pc_fichiers_read ON public.pc_fichiers FOR SELECT TO authenticated USING (public.pc_can_read(auth.uid(), dossier_id));
DROP POLICY IF EXISTS pc_fichiers_insert ON public.pc_fichiers;
CREATE POLICY pc_fichiers_insert ON public.pc_fichiers FOR INSERT TO authenticated
  WITH CHECK (public.pc_can_write(auth.uid(), dossier_id) AND uploaded_by = auth.uid());

-- Historique : lecture si lecture dossier ; ajout manuel par un contributeur, en son nom.
DROP POLICY IF EXISTS pc_evenements_read ON public.pc_evenements;
CREATE POLICY pc_evenements_read ON public.pc_evenements FOR SELECT TO authenticated USING (public.pc_can_read(auth.uid(), dossier_id));
DROP POLICY IF EXISTS pc_evenements_insert ON public.pc_evenements;
CREATE POLICY pc_evenements_insert ON public.pc_evenements FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() AND public.pc_can_write(auth.uid(), dossier_id));

-- =====================================================================
-- Déclencheurs
-- =====================================================================
DROP TRIGGER IF EXISTS trg_pc_etape_modeles_updated ON public.pc_etape_modeles;
CREATE TRIGGER trg_pc_etape_modeles_updated BEFORE UPDATE ON public.pc_etape_modeles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_pc_piece_types_updated ON public.pc_piece_types;
CREATE TRIGGER trg_pc_piece_types_updated BEFORE UPDATE ON public.pc_piece_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_pc_dossiers_updated ON public.pc_dossiers;
CREATE TRIGGER trg_pc_dossiers_updated BEFORE UPDATE ON public.pc_dossiers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_pc_etapes_updated ON public.pc_etapes;
CREATE TRIGGER trg_pc_etapes_updated BEFORE UPDATE ON public.pc_etapes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_pc_documents_updated ON public.pc_documents;
CREATE TRIGGER trg_pc_documents_updated BEFORE UPDATE ON public.pc_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.pc_log(_dossier uuid, _etape uuid, _action text, _details jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  -- Ignoré quand le dossier lui-même est supprimé (cascade) : l'historique part avec lui.
  INSERT INTO public.pc_evenements (dossier_id, etape_id, actor_id, action, details)
  SELECT _dossier, _etape, auth.uid(), _action, coalesce(_details, '{}'::jsonb)
  WHERE EXISTS (SELECT 1 FROM public.pc_dossiers WHERE id = _dossier);
$$;

-- Notifie un utilisateur (jamais l'auteur de l'action lui-même).
CREATE OR REPLACE FUNCTION public.pc_notify(_user uuid, _type text, _titre text, _message text, _dossier uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user IS NULL OR _user = auth.uid() THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  VALUES (_user, _type::public.notification_type, _titre, _message, '/pole-certification/' || _dossier);
END $$;

-- Dossier créé → étapes par défaut ; journal des changements du dossier.
CREATE OR REPLACE FUNCTION public.pc_on_dossier_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_first int;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT min(ordre) INTO v_first FROM public.pc_etape_modeles WHERE dossier_type = NEW.type AND actif;
    INSERT INTO public.pc_etapes (dossier_id, ordre, intitule, a_saisir, relance_jours, en_cours_max_jours, event_kind,
      lien_expiration, bloque_si_piece_perimee, collecte_pieces, checklist, email_actif, responsable_id, date_debut)
    SELECT NEW.id, m.ordre, m.intitule, m.a_saisir, m.relance_jours, m.en_cours_max_jours, m.event_kind,
      m.lien_expiration, m.bloque_si_piece_perimee, m.collecte_pieces,
      coalesce((SELECT jsonb_object_agg(c, false) FROM unnest(m.checklist) c), '{}'::jsonb),
      m.email_actif, NEW.responsable_id, CASE WHEN m.ordre = v_first THEN current_date END
    FROM public.pc_etape_modeles m
    WHERE m.dossier_type = NEW.type AND m.actif
    ORDER BY m.ordre;
    PERFORM public.pc_log(NEW.id, NULL, 'dossier.cree', jsonb_build_object('type', NEW.type, 'titre', NEW.titre, 'responsable', NEW.responsable_id));
    PERFORM public.pc_notify(NEW.responsable_id, 'pc_etape', 'Nouveau dossier ' || upper(NEW.type) || ' vous est confié', NEW.titre, NEW.id);
    RETURN NEW;
  END IF;

  IF NEW.responsable_id IS DISTINCT FROM OLD.responsable_id THEN
    PERFORM public.pc_log(NEW.id, NULL, 'dossier.responsable', jsonb_build_object('ancien', OLD.responsable_id, 'nouveau', NEW.responsable_id));
    PERFORM public.pc_notify(NEW.responsable_id, 'pc_etape', 'Dossier transféré à votre nom', NEW.titre, NEW.id);
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    PERFORM public.pc_log(NEW.id, NULL, CASE WHEN NEW.archived_at IS NULL THEN 'dossier.desarchive' ELSE 'dossier.archive' END, '{}'::jsonb);
  END IF;
  IF NEW.titre IS DISTINCT FROM OLD.titre THEN v_changes := v_changes || jsonb_build_object('titre', jsonb_build_array(OLD.titre, NEW.titre)); END IF;
  IF NEW.organisme IS DISTINCT FROM OLD.organisme THEN v_changes := v_changes || jsonb_build_object('organisme', jsonb_build_array(OLD.organisme, NEW.organisme)); END IF;
  IF NEW.certificateur IS DISTINCT FROM OLD.certificateur THEN v_changes := v_changes || jsonb_build_object('certificateur', jsonb_build_array(OLD.certificateur, NEW.certificateur)); END IF;
  IF NEW.code_rs IS DISTINCT FROM OLD.code_rs THEN v_changes := v_changes || jsonb_build_object('code_rs', jsonb_build_array(OLD.code_rs, NEW.code_rs)); END IF;
  IF NEW.date_cible IS DISTINCT FROM OLD.date_cible THEN v_changes := v_changes || jsonb_build_object('date_cible', jsonb_build_array(OLD.date_cible, NEW.date_cible)); END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN v_changes := v_changes || jsonb_build_object('notes', jsonb_build_array(OLD.notes, NEW.notes)); END IF;
  IF v_changes <> '{}'::jsonb THEN
    PERFORM public.pc_log(NEW.id, NULL, 'dossier.modifie', v_changes);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pc_dossier_change ON public.pc_dossiers;
CREATE TRIGGER trg_pc_dossier_change AFTER INSERT OR UPDATE ON public.pc_dossiers FOR EACH ROW EXECUTE FUNCTION public.pc_on_dossier_change();

-- Règles avant écriture d'une étape : dates automatiques + blocage pièce périmée.
CREATE OR REPLACE FUNCTION public.pc_before_etape()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_perimees text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.statut IS DISTINCT FROM OLD.statut THEN
    NEW.statut_change_at := now();
    IF NEW.statut = 'en_cours' AND NEW.date_debut IS NULL THEN NEW.date_debut := current_date; END IF;
    IF NEW.statut = 'en_attente' THEN NEW.envoye_at := now(); END IF;
    IF NEW.statut = 'valide' AND NEW.date_realisation IS NULL THEN NEW.date_realisation := current_date; END IF;

    IF NEW.statut = 'valide' AND NEW.bloque_si_piece_perimee THEN
      SELECT string_agg(d.nom, ', ') INTO v_perimees
      FROM public.pc_documents d
      WHERE d.dossier_id = NEW.dossier_id AND d.date_peremption IS NOT NULL AND d.date_peremption < current_date;
      IF v_perimees IS NOT NULL THEN
        IF auth.uid() IS NOT NULL AND public.pc_is_admin(auth.uid()) AND coalesce(trim(NEW.force_motif), '') <> '' THEN
          NEW.force_par := auth.uid();
        ELSE
          RAISE EXCEPTION 'Pièce(s) périmée(s) : %. Déposez une version de moins de 3 mois (ou forçage administrateur avec motif).', v_perimees
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.force_motif IS DISTINCT FROM OLD.force_motif AND NEW.force_par IS NOT DISTINCT FROM OLD.force_par THEN
    NEW.force_motif := OLD.force_motif; -- le motif ne se pose qu'avec un forçage effectif
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pc_before_etape ON public.pc_etapes;
CREATE TRIGGER trg_pc_before_etape BEFORE INSERT OR UPDATE ON public.pc_etapes FOR EACH ROW EXECUTE FUNCTION public.pc_before_etape();

-- Après écriture d'une étape : journal, enchaînement, notifications.
CREATE OR REPLACE FUNCTION public.pc_after_etape()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.pc_dossiers%ROWTYPE;
  v_next public.pc_etapes%ROWTYPE;
  v_changes jsonb := '{}'::jsonb;
  v_admin uuid;
  v_label text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.pc_log(OLD.dossier_id, OLD.id, 'etape.supprimee', jsonb_build_object('ordre', OLD.ordre, 'intitule', OLD.intitule));
    RETURN OLD;
  END IF;

  SELECT * INTO d FROM public.pc_dossiers WHERE id = NEW.dossier_id;
  v_label := 'Étape ' || NEW.ordre || ' — ' || NEW.intitule;

  IF TG_OP = 'INSERT' THEN
    -- Les étapes par défaut sont journalisées par « dossier.cree ».
    IF NEW.created_at > d.created_at + interval '2 seconds' OR NEW.tentative > 1 THEN
      PERFORM public.pc_log(NEW.dossier_id, NEW.id, 'etape.ajoutee',
        jsonb_build_object('ordre', NEW.ordre, 'intitule', NEW.intitule, 'tentative', NEW.tentative));
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    PERFORM public.pc_log(NEW.dossier_id, NEW.id, 'etape.statut',
      jsonb_build_object('ordre', NEW.ordre, 'intitule', NEW.intitule, 'tentative', NEW.tentative,
                         'ancien', OLD.statut, 'nouveau', NEW.statut, 'motif', NEW.motif_refus));

    IF NEW.statut = 'valide' THEN
      IF NEW.force_par IS NOT NULL AND OLD.force_par IS NULL THEN
        PERFORM public.pc_log(NEW.dossier_id, NEW.id, 'etape.forcage', jsonb_build_object('motif', NEW.force_motif));
      END IF;
      SELECT * INTO v_next FROM public.pc_etapes
        WHERE dossier_id = NEW.dossier_id AND NOT remplacee AND ordre > NEW.ordre
        ORDER BY ordre, tentative DESC LIMIT 1;
      IF FOUND THEN
        IF v_next.statut = 'a_faire' AND v_next.date_debut IS NULL THEN
          UPDATE public.pc_etapes SET date_debut = current_date WHERE id = v_next.id;
        END IF;
        PERFORM public.pc_notify(coalesce(v_next.responsable_id, d.responsable_id), 'pc_etape',
          v_label || ' validée : étape suivante à lancer', 'Étape ' || v_next.ordre || ' — ' || v_next.intitule || ' (' || d.titre || ')', d.id);
        IF coalesce(v_next.responsable_id, d.responsable_id) IS DISTINCT FROM d.responsable_id THEN
          PERFORM public.pc_notify(d.responsable_id, 'pc_etape', v_label || ' validée', d.titre, d.id);
        END IF;
      ELSE
        PERFORM public.pc_notify(d.responsable_id, 'pc_etape',
          CASE WHEN d.type = 'certificateur' THEN 'Parcours certificateur terminé : créer le dossier EDOF lié ?'
               ELSE 'Parcours EDOF terminé' END, d.titre, d.id);
      END IF;
    ELSIF NEW.statut = 'refuse' THEN
      PERFORM public.pc_notify(coalesce(NEW.responsable_id, d.responsable_id), 'pc_refus', 'Refus : ' || v_label,
        coalesce(NEW.motif_refus, '') || ' — saisir le délai de recours ou recommencer (' || d.titre || ')', d.id);
      IF NEW.responsable_id IS DISTINCT FROM d.responsable_id THEN
        PERFORM public.pc_notify(d.responsable_id, 'pc_refus', 'Refus : ' || v_label, coalesce(NEW.motif_refus, ''), d.id);
      END IF;
      FOR v_admin IN SELECT public.pc_admin_ids() LOOP
        IF v_admin IS DISTINCT FROM d.responsable_id AND v_admin IS DISTINCT FROM NEW.responsable_id THEN
          PERFORM public.pc_notify(v_admin, 'pc_refus', 'Refus : ' || v_label, d.titre || ' — ' || coalesce(NEW.motif_refus, ''), d.id);
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF NEW.notes IS DISTINCT FROM OLD.notes THEN v_changes := v_changes || jsonb_build_object('notes', jsonb_build_array(OLD.notes, NEW.notes)); END IF;
  IF NEW.motif_refus IS DISTINCT FROM OLD.motif_refus AND NEW.statut IS NOT DISTINCT FROM OLD.statut THEN
    v_changes := v_changes || jsonb_build_object('motif_refus', jsonb_build_array(OLD.motif_refus, NEW.motif_refus)); END IF;
  IF NEW.intitule IS DISTINCT FROM OLD.intitule THEN v_changes := v_changes || jsonb_build_object('intitule', jsonb_build_array(OLD.intitule, NEW.intitule)); END IF;
  IF NEW.ordre IS DISTINCT FROM OLD.ordre THEN v_changes := v_changes || jsonb_build_object('ordre', jsonb_build_array(OLD.ordre, NEW.ordre)); END IF;
  IF NEW.date_debut IS DISTINCT FROM OLD.date_debut AND pg_trigger_depth() = 1 THEN v_changes := v_changes || jsonb_build_object('date_debut', jsonb_build_array(OLD.date_debut, NEW.date_debut)); END IF;
  IF NEW.date_echeance IS DISTINCT FROM OLD.date_echeance THEN v_changes := v_changes || jsonb_build_object('date_echeance', jsonb_build_array(OLD.date_echeance, NEW.date_echeance)); END IF;
  IF NEW.date_realisation IS DISTINCT FROM OLD.date_realisation THEN v_changes := v_changes || jsonb_build_object('date_realisation', jsonb_build_array(OLD.date_realisation, NEW.date_realisation)); END IF;
  IF NEW.date_limite_recours IS DISTINCT FROM OLD.date_limite_recours THEN v_changes := v_changes || jsonb_build_object('date_limite_recours', jsonb_build_array(OLD.date_limite_recours, NEW.date_limite_recours)); END IF;
  IF NEW.event_at IS DISTINCT FROM OLD.event_at THEN v_changes := v_changes || jsonb_build_object('event_at', jsonb_build_array(OLD.event_at, NEW.event_at)); END IF;
  IF NEW.lien_expire_at IS DISTINCT FROM OLD.lien_expire_at THEN v_changes := v_changes || jsonb_build_object('lien_expire_at', jsonb_build_array(OLD.lien_expire_at, NEW.lien_expire_at)); END IF;
  IF NEW.checklist IS DISTINCT FROM OLD.checklist THEN v_changes := v_changes || jsonb_build_object('checklist', NEW.checklist); END IF;
  IF NEW.responsable_id IS DISTINCT FROM OLD.responsable_id THEN
    v_changes := v_changes || jsonb_build_object('responsable', jsonb_build_array(OLD.responsable_id, NEW.responsable_id));
    PERFORM public.pc_notify(NEW.responsable_id, 'pc_etape', 'Étape confiée : ' || v_label, d.titre, d.id);
  END IF;
  IF v_changes <> '{}'::jsonb THEN
    PERFORM public.pc_log(NEW.dossier_id, NEW.id, 'etape.modifiee', v_changes || jsonb_build_object('_ordre', NEW.ordre, '_intitule', NEW.intitule));
  END IF;
  IF NEW.rappel_reporte_jusqua IS DISTINCT FROM OLD.rappel_reporte_jusqua AND NEW.rappel_reporte_jusqua IS NOT NULL THEN
    PERFORM public.pc_log(NEW.dossier_id, NEW.id, 'rappel.reporte', jsonb_build_object('jusqua', NEW.rappel_reporte_jusqua, 'ordre', NEW.ordre, 'intitule', NEW.intitule));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pc_after_etape ON public.pc_etapes;
CREATE TRIGGER trg_pc_after_etape AFTER INSERT OR UPDATE OR DELETE ON public.pc_etapes FOR EACH ROW EXECUTE FUNCTION public.pc_after_etape();

-- Pièces et fichiers : journal.
CREATE OR REPLACE FUNCTION public.pc_on_document_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.pc_log(NEW.dossier_id, NULL, 'piece.ajoutee', jsonb_build_object('nom', NEW.nom, 'date_emission', NEW.date_emission));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.pc_log(OLD.dossier_id, NULL, 'piece.supprimee', jsonb_build_object('nom', OLD.nom));
    RETURN OLD;
  ELSE
    IF NEW.date_emission IS DISTINCT FROM OLD.date_emission OR NEW.validite_jours IS DISTINCT FROM OLD.validite_jours
       OR NEW.nom IS DISTINCT FROM OLD.nom OR NEW.etapes IS DISTINCT FROM OLD.etapes THEN
      PERFORM public.pc_log(NEW.dossier_id, NULL, 'piece.modifiee', jsonb_build_object('nom', NEW.nom,
        'date_emission', jsonb_build_array(OLD.date_emission, NEW.date_emission),
        'validite_jours', jsonb_build_array(OLD.validite_jours, NEW.validite_jours)));
    END IF;
    IF NEW.rappel_reporte_jusqua IS DISTINCT FROM OLD.rappel_reporte_jusqua AND NEW.rappel_reporte_jusqua IS NOT NULL THEN
      PERFORM public.pc_log(NEW.dossier_id, NULL, 'rappel.reporte', jsonb_build_object('piece', NEW.nom, 'jusqua', NEW.rappel_reporte_jusqua));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pc_document_change ON public.pc_documents;
CREATE TRIGGER trg_pc_document_change AFTER INSERT OR UPDATE OR DELETE ON public.pc_documents FOR EACH ROW EXECUTE FUNCTION public.pc_on_document_change();

CREATE OR REPLACE FUNCTION public.pc_on_fichier_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.pc_log(NEW.dossier_id, NEW.etape_id,
    CASE WHEN NEW.document_id IS NOT NULL THEN 'piece.version' ELSE 'etape.fichier' END,
    jsonb_build_object('fichier', NEW.filename, 'version', NEW.version, 'document_id', NEW.document_id));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pc_fichier_insert ON public.pc_fichiers;
CREATE TRIGGER trg_pc_fichier_insert AFTER INSERT ON public.pc_fichiers FOR EACH ROW EXECUTE FUNCTION public.pc_on_fichier_insert();

CREATE OR REPLACE FUNCTION public.pc_on_membre_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.pc_log(OLD.dossier_id, NULL, 'membre.retire', jsonb_build_object('user', OLD.user_id));
    RETURN OLD;
  END IF;
  PERFORM public.pc_log(NEW.dossier_id, NULL, 'membre.ajoute', jsonb_build_object('user', NEW.user_id, 'role', NEW.role));
  PERFORM public.pc_notify(NEW.user_id, 'pc_etape', 'Vous êtes affecté à un dossier du pôle Certification & EDOF',
    (SELECT titre FROM public.pc_dossiers WHERE id = NEW.dossier_id), NEW.dossier_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pc_membre_change ON public.pc_membres;
CREATE TRIGGER trg_pc_membre_change AFTER INSERT OR UPDATE OR DELETE ON public.pc_membres FOR EACH ROW EXECUTE FUNCTION public.pc_on_membre_change();

-- « À recommencer » : l'ancienne tentative reste dans l'historique, une nouvelle est créée.
CREATE OR REPLACE FUNCTION public.pc_recommencer_etape(_etape uuid, _echeance date)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  e public.pc_etapes%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO e FROM public.pc_etapes WHERE id = _etape FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Étape introuvable'; END IF;
  IF e.remplacee THEN RAISE EXCEPTION 'Cette tentative a déjà été recommencée'; END IF;
  IF e.statut NOT IN ('refuse','recours') THEN RAISE EXCEPTION 'Seule une étape refusée ou en recours peut être recommencée'; END IF;

  UPDATE public.pc_etapes SET statut = 'a_recommencer', remplacee = true WHERE id = e.id;
  INSERT INTO public.pc_etapes (dossier_id, groupe, ordre, intitule, tentative, statut, date_debut, date_echeance,
    responsable_id, a_saisir, relance_jours, en_cours_max_jours, event_kind, lien_expiration,
    bloque_si_piece_perimee, collecte_pieces, checklist, email_actif)
  VALUES (e.dossier_id, e.groupe, e.ordre, e.intitule, e.tentative + 1, 'a_faire', current_date, _echeance,
    e.responsable_id, e.a_saisir, e.relance_jours, e.en_cours_max_jours, e.event_kind, e.lien_expiration,
    e.bloque_si_piece_perimee, e.collecte_pieces,
    coalesce((SELECT jsonb_object_agg(k, false) FROM jsonb_object_keys(e.checklist) k), '{}'::jsonb), e.email_actif)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.pc_is_admin(uuid), public.pc_can_read(uuid, uuid), public.pc_can_write(uuid, uuid),
  public.pc_has_access(uuid), public.pc_admin_ids(), public.pc_recommencer_etape(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pc_is_admin(uuid), public.pc_can_read(uuid, uuid), public.pc_can_write(uuid, uuid),
  public.pc_has_access(uuid), public.pc_admin_ids(), public.pc_recommencer_etape(uuid, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.pc_log(uuid, uuid, text, jsonb), public.pc_notify(uuid, text, text, text, uuid),
  public.pc_on_dossier_change(), public.pc_before_etape(), public.pc_after_etape(), public.pc_on_document_change(),
  public.pc_on_fichier_insert(), public.pc_on_membre_change() FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- Stockage privé des pièces (identité des dirigeants…) : droits par dossier.
-- =====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('pole-certification', 'pole-certification', false, 52428800)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS pc_storage_read ON storage.objects;
CREATE POLICY pc_storage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pole-certification' AND public.pc_can_read(auth.uid(), public.pc_path_dossier(name)));
DROP POLICY IF EXISTS pc_storage_insert ON storage.objects;
CREATE POLICY pc_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pole-certification' AND public.pc_can_write(auth.uid(), public.pc_path_dossier(name)));

-- =====================================================================
-- Valeurs par défaut (modifiables dans Paramètres)
-- Sources EDOF : of.moncompteformation.gouv.fr/espace-public/demarrer-sur-edof
-- =====================================================================
INSERT INTO public.pc_etape_modeles (dossier_type, ordre, intitule, a_saisir, relance_jours, en_cours_max_jours, event_kind, lien_expiration, bloque_si_piece_perimee, collecte_pieces, checklist)
SELECT * FROM (VALUES
  ('certificateur', 1, 'Prise de contact : demande de RDV ou mail au certificateur, premier appel',
     'Date, moyen (mail / téléphone), interlocuteur, compte rendu de l''appel', 7, NULL::int, NULL::text, false, false, false, '{}'::text[]),
  ('certificateur', 2, 'Visio : confirmation que le dossier RS est fait',
     'Date et heure de la visio (ajoutée au calendrier), compte rendu', NULL, NULL, 'visio', false, false, false, '{}'),
  ('certificateur', 3, 'Dossier envoyé au certificateur',
     'Date d''envoi, preuve d''envoi, version du dossier', 15, NULL, NULL, false, false, false, '{}'),
  ('certificateur', 4, 'Dossier validé, RS confirmé',
     'Date de validation, document de confirmation / convention d''habilitation', NULL, NULL, NULL, false, false, false, '{}'),
  ('edof', 0, 'Collecte des documents (moins de 3 mois)',
     'Liste des pièces avec date d''émission. Prérequis EDOF : NDA actif, Qualiopi, habilitation du certificateur pour les formations RS/RNCP. Formats acceptés par la CDC : PDF, PNG, JPG, JPEG, GIF, BMP.',
     NULL, NULL, NULL, false, false, true,
     ARRAY['NDA actif (Mon Activité Formation)','Certification Qualiopi valide','Habilitation du certificateur (formations RS / RNCP)','Formations éligibles au CPF','Compte EFP Connect créé','CGU EDOF lues et acceptées']),
  ('edof', 1, 'Responsable des accès : mails envoyés à la CDC',
     'Nom du responsable des accès, date d''envoi, copie du mail. Demande d''habilitation à drca_mcf_OF_N1@caissedesdepots.fr, pièces via France Transfert.', 7, NULL, NULL, false, false, false, '{}'),
  ('edof', 2, 'Réception du mail avec le lien et le code de la CDC',
     'Date de réception, date d''expiration du lien ou du code. Le code nomme le « Responsable des accès EDOF ».', NULL, NULL, NULL, true, false, false, '{}'),
  ('edof', 3, 'Remplir le catalogue : infos société et dirigeants',
     'Formulaire de demande de référencement sur EDOF (SIRET concerné). Cocher chaque bloc rempli.', NULL, 7, NULL, false, false, false,
     ARRAY['Société','Dirigeants','Offre']),
  ('edof', 4, 'Déposer les documents',
     'Liste des pièces déposées, date de dépôt, pièces complémentaires demandées par la CDC.', NULL, NULL, NULL, false, true, false, '{}'),
  ('edof', 5, 'Webinaire / décision CDC',
     'Date du webinaire (ajoutée au calendrier), décision : Validé ou Refusé. Télécharger la décision sur EDOF.', NULL, NULL, 'webinaire', false, false, false, '{}'),
  ('edof', 6, 'Mise en service EDOF après acceptation',
     'Attendre 48 h après la décision, puis compléter l''espace EDOF.', NULL, NULL, NULL, false, false, false,
     ARRAY['Habilitations des collaborateurs','Coordonnées bancaires','Contacts de l''organisme','Catalogue de formations','Ancien SIRET clôturé (si besoin)'])
) AS v(dossier_type, ordre, intitule, a_saisir, relance_jours, en_cours_max_jours, event_kind, lien_expiration, bloque_si_piece_perimee, collecte_pieces, checklist)
WHERE NOT EXISTS (SELECT 1 FROM public.pc_etape_modeles);

INSERT INTO public.pc_piece_types (code, libelle, aide, validite_jours, dossier_types, obligatoire, ordre) VALUES
  ('kbis', 'Extrait Kbis ou extrait RNE', 'Société : extrait de moins de 3 mois', 90, '{edof}', true, 1),
  ('identite_representant', 'Pièce d''identité du représentant légal (recto / verso)', 'Passeport, CNI ou titre de séjour en cours de validité', NULL, '{edof}', true, 2),
  ('non_condamnation', 'Déclaration de non-condamnation et de filiation', 'Moins de 3 mois (modèle service-public.fr)', 90, '{edof}', true, 3),
  ('urssaf', 'Attestation de vigilance URSSAF', NULL, 90, '{edof}', false, 4),
  ('statuts_association', 'Statuts à jour (association)', 'Membres du bureau et leurs rôles', NULL, '{edof}', false, 5),
  ('pv_ag', 'Dernier PV d''assemblée générale (association)', NULL, NULL, '{edof}', false, 6),
  ('joafe', 'Récépissé de publication au JOAFE (association)', NULL, 90, '{edof}', false, 7),
  ('agrement', 'Agrément préfectoral ou ministériel', 'Auto-école, formation des élus', NULL, '{edof}', false, 8),
  ('qualiopi', 'Certificat Qualiopi', NULL, NULL, '{edof}', false, 9),
  ('habilitation_certificateur', 'Habilitation du certificateur (former / évaluer)', 'Formations RS ou RNCP', NULL, '{edof,certificateur}', false, 10),
  ('dossier_rs', 'Dossier RS (version envoyée)', NULL, NULL, '{certificateur}', true, 11),
  ('convention_certificateur', 'Convention / confirmation du certificateur', NULL, NULL, '{certificateur}', false, 12)
ON CONFLICT (code) DO NOTHING;

-- =====================================================================
-- Rappels : appel horaire du hook (même mécanique que izisuivis-reminders).
-- =====================================================================
DO $$
DECLARE v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pc-reminders') THEN
    PERFORM cron.unschedule('pc-reminders');
  END IF;
  PERFORM cron.schedule('pc-reminders', '5 * * * *', format($cmd$
    SELECT net.http_post(
      url := 'https://project--51e3d791-7911-46e0-8fee-3de01cd0ad09.lovable.app/api/public/hooks/pole-certification-reminders',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
      body := '{}'::jsonb
    );
  $cmd$, v_key));
END $$;
