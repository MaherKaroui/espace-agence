
-- ============================================================
-- 1) PORTÉE PAR PÔLE : HELPERS
-- ============================================================

-- Un dossier est-il dans le périmètre du user ? (admin/direction = oui, sinon membre d'un pôle actif du dossier)
CREATE OR REPLACE FUNCTION public.dossier_in_scope(_user uuid, _dossier uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_user, 'admin'::app_role)
    OR public.has_role(_user, 'direction'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.dossiers d
      JOIN public.poles p ON p.id = d.pole_id
      JOIN public.pole_members pm ON pm.pole_id = d.pole_id
      WHERE d.id = _dossier
        AND p.actif = true
        AND pm.user_id = _user
    );
$$;

-- Un client est-il dans le périmètre du staff ? (admin/direction, sinon existe un dossier du client dans un pôle actif du staff)
CREATE OR REPLACE FUNCTION public.client_in_scope(_staff uuid, _client uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_staff, 'admin'::app_role)
    OR public.has_role(_staff, 'direction'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.dossiers d
      JOIN public.poles p ON p.id = d.pole_id
      JOIN public.pole_members pm ON pm.pole_id = d.pole_id
      WHERE d.client_id = _client
        AND p.actif = true
        AND pm.user_id = _staff
    );
$$;

-- Un utilisateur est-il membre de l'agence (staff) ?
CREATE OR REPLACE FUNCTION public.is_agency_member(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user
      AND role IN ('admin','direction','manager','consultant')
  );
$$;

-- Deux membres agence peuvent-ils s'écrire (même pôle actif, ou l'un est admin/direction) ?
CREATE OR REPLACE FUNCTION public.can_internal_contact(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    _a = _b
    OR (public.is_agency_member(_a) AND public.is_agency_member(_b) AND (
      public.has_role(_a, 'admin'::app_role) OR public.has_role(_a, 'direction'::app_role)
      OR public.has_role(_b, 'admin'::app_role) OR public.has_role(_b, 'direction'::app_role)
      OR EXISTS (
        SELECT 1
        FROM public.pole_members pma
        JOIN public.pole_members pmb ON pmb.pole_id = pma.pole_id
        JOIN public.poles p ON p.id = pma.pole_id
        WHERE pma.user_id = _a AND pmb.user_id = _b AND p.actif = true
      )
    ));
$$;

-- ============================================================
-- 2) RENFORCER LES POLICIES EXISTANTES (staff : pôle actif requis)
-- ============================================================

-- dossiers : SELECT staff limité aux pôles actifs
DROP POLICY IF EXISTS "Staff read dossiers of their poles" ON public.dossiers;
CREATE POLICY "dossiers_select_scope"
  ON public.dossiers FOR SELECT
  TO authenticated
  USING (public.dossier_in_scope(auth.uid(), id));

DROP POLICY IF EXISTS "Staff update dossiers of their poles" ON public.dossiers;
CREATE POLICY "dossiers_update_scope"
  ON public.dossiers FOR UPDATE
  TO authenticated
  USING (public.dossier_in_scope(auth.uid(), id))
  WITH CHECK (public.dossier_in_scope(auth.uid(), id));

-- documents : SELECT/UPDATE staff via dossier_in_scope
DROP POLICY IF EXISTS "documents_select_staff_pole" ON public.documents;
CREATE POLICY "documents_select_staff_scope"
  ON public.documents FOR SELECT
  TO authenticated
  USING (public.dossier_in_scope(auth.uid(), dossier_id));

DROP POLICY IF EXISTS "documents_update_staff" ON public.documents;
CREATE POLICY "documents_update_staff_scope"
  ON public.documents FOR UPDATE
  TO authenticated
  USING (public.dossier_in_scope(auth.uid(), dossier_id))
  WITH CHECK (public.dossier_in_scope(auth.uid(), dossier_id));

DROP POLICY IF EXISTS "documents_insert_scoped" ON public.documents;
CREATE POLICY "documents_insert_scoped"
  ON public.documents FOR INSERT
  TO authenticated
  WITH CHECK (
    public.dossier_in_scope(auth.uid(), dossier_id)
    OR EXISTS (SELECT 1 FROM public.dossiers d WHERE d.id = documents.dossier_id AND d.client_id = auth.uid())
  );

-- taches : SELECT/UPDATE/INSERT staff via dossier_in_scope
DROP POLICY IF EXISTS "taches_select_pole_staff" ON public.taches;
CREATE POLICY "taches_select_scope"
  ON public.taches FOR SELECT
  TO authenticated
  USING (public.dossier_in_scope(auth.uid(), dossier_id));

DROP POLICY IF EXISTS "taches_update_pole_staff" ON public.taches;
CREATE POLICY "taches_update_scope"
  ON public.taches FOR UPDATE
  TO authenticated
  USING (
    public.dossier_in_scope(auth.uid(), dossier_id)
    OR EXISTS (SELECT 1 FROM public.dossiers d WHERE d.id = taches.dossier_id AND d.client_id = auth.uid())
  );

DROP POLICY IF EXISTS "taches_write_pole_staff" ON public.taches;
CREATE POLICY "taches_insert_scope"
  ON public.taches FOR INSERT
  TO authenticated
  WITH CHECK (public.dossier_in_scope(auth.uid(), dossier_id));

-- messages : SELECT/INSERT staff via client_in_scope
DROP POLICY IF EXISTS "messages_select_pole_staff" ON public.messages;
CREATE POLICY "messages_select_scope"
  ON public.messages FOR SELECT
  TO authenticated
  USING (public.client_in_scope(auth.uid(), client_id));

DROP POLICY IF EXISTS "messages_insert_staff" ON public.messages;
CREATE POLICY "messages_insert_staff_scope"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND from_agence = true
    AND public.client_in_scope(auth.uid(), client_id)
  );

-- client_notes : SELECT/INSERT/UPDATE/DELETE staff via client_in_scope
DROP POLICY IF EXISTS "client_notes_select_staff" ON public.client_notes;
CREATE POLICY "client_notes_select_scope"
  ON public.client_notes FOR SELECT
  TO authenticated
  USING (public.client_in_scope(auth.uid(), client_id));

DROP POLICY IF EXISTS "client_notes_insert_staff" ON public.client_notes;
CREATE POLICY "client_notes_insert_scope"
  ON public.client_notes FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.client_in_scope(auth.uid(), client_id));

DROP POLICY IF EXISTS "client_notes_update_staff" ON public.client_notes;
CREATE POLICY "client_notes_update_scope"
  ON public.client_notes FOR UPDATE
  TO authenticated
  USING (public.client_in_scope(auth.uid(), client_id) AND (author_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
  WITH CHECK (public.client_in_scope(auth.uid(), client_id));

DROP POLICY IF EXISTS "client_notes_delete_staff" ON public.client_notes;
CREATE POLICY "client_notes_delete_scope"
  ON public.client_notes FOR DELETE
  TO authenticated
  USING (public.client_in_scope(auth.uid(), client_id) AND (author_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

-- ============================================================
-- 3) ARCHIVAGE CLIENTS
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS archive_reason text;

-- profile SELECT : filtre les archivés pour le staff non-direction ; le client conserve toujours l'accès à SON profil
DROP POLICY IF EXISTS "profiles_select_scoped" ON public.profiles;
CREATE POLICY "profiles_select_scoped"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'direction')
    OR (archived_at IS NULL AND public.client_in_scope(auth.uid(), id))
    OR public.shares_conversation(auth.uid(), id)
  );

-- Fonction d'archivage (admin/direction) : anonymise + verrouille les sessions
CREATE OR REPLACE FUNCTION public.archive_client(_user_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction')) THEN
    RAISE EXCEPTION 'Réservé à la direction / administration';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Vous ne pouvez pas archiver votre propre compte';
  END IF;

  UPDATE public.profiles
     SET archived_at = now(),
         archived_by = auth.uid(),
         archive_reason = COALESCE(_reason, archive_reason)
   WHERE id = _user_id AND archived_at IS NULL;

  -- Termine toutes les sessions actives
  UPDATE public.user_sessions
     SET ended_at = COALESCE(ended_at, now()),
         duration_seconds = COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int))
   WHERE user_id = _user_id AND ended_at IS NULL;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'client.archived', 'user', _user_id, 'warning',
          jsonb_build_object('reason', _reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.unarchive_client(_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Réservé aux administrateurs';
  END IF;
  UPDATE public.profiles
     SET archived_at = NULL, archived_by = NULL, archive_reason = NULL
   WHERE id = _user_id;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'client.unarchived', 'user', _user_id, 'info', '{}'::jsonb);
END;
$$;

-- ============================================================
-- 4) MESSAGERIE INTERNE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.internal_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titre text,
  is_group boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.internal_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  added_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS internal_conv_members_user_idx ON public.internal_conversation_members(user_id);

CREATE TABLE IF NOT EXISTS public.internal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.internal_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  content text,
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid
);
CREATE INDEX IF NOT EXISTS internal_messages_conv_idx ON public.internal_messages(conversation_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_conversation_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_messages TO authenticated;
GRANT ALL ON public.internal_conversations TO service_role;
GRANT ALL ON public.internal_conversation_members TO service_role;
GRANT ALL ON public.internal_messages TO service_role;

ALTER TABLE public.internal_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_messages ENABLE ROW LEVEL SECURITY;

-- Helpers de membership (SECURITY DEFINER pour éviter la récursion RLS)
CREATE OR REPLACE FUNCTION public.is_internal_member(_user uuid, _conv uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.internal_conversation_members
                  WHERE conversation_id = _conv AND user_id = _user);
$$;

CREATE OR REPLACE FUNCTION public.is_internal_owner(_user uuid, _conv uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.internal_conversation_members
                  WHERE conversation_id = _conv AND user_id = _user AND role = 'owner');
$$;

-- internal_conversations policies
CREATE POLICY "int_conv_insert_agency"
  ON public.internal_conversations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_agency_member(auth.uid()));

CREATE POLICY "int_conv_select_members"
  ON public.internal_conversations FOR SELECT TO authenticated
  USING (public.is_internal_member(auth.uid(), id) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "int_conv_update_owner"
  ON public.internal_conversations FOR UPDATE TO authenticated
  USING (public.is_internal_owner(auth.uid(), id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.is_internal_owner(auth.uid(), id) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "int_conv_delete_owner"
  ON public.internal_conversations FOR DELETE TO authenticated
  USING (public.is_internal_owner(auth.uid(), id) OR public.has_role(auth.uid(),'admin'));

-- internal_conversation_members policies
CREATE POLICY "int_members_select"
  ON public.internal_conversation_members FOR SELECT TO authenticated
  USING (public.is_internal_member(auth.uid(), conversation_id) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "int_members_insert"
  ON public.internal_conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    public.is_agency_member(user_id)
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.is_internal_owner(auth.uid(), conversation_id)
      OR (
        -- Insertion initiale par le créateur : la conv est vide et il en est l'auteur
        NOT EXISTS (SELECT 1 FROM public.internal_conversation_members WHERE conversation_id = internal_conversation_members.conversation_id)
        AND EXISTS (SELECT 1 FROM public.internal_conversations c
                      WHERE c.id = internal_conversation_members.conversation_id AND c.created_by = auth.uid())
      )
      OR (
        -- Ajout d'un membre par un owner déjà membre : contact autorisé
        public.is_internal_owner(auth.uid(), conversation_id)
        AND public.can_internal_contact(auth.uid(), user_id)
      )
    )
  );

CREATE POLICY "int_members_update_last_read"
  ON public.internal_conversation_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "int_members_delete"
  ON public.internal_conversation_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_internal_owner(auth.uid(), conversation_id) OR public.has_role(auth.uid(),'admin'));

-- internal_messages policies
CREATE POLICY "int_msg_select"
  ON public.internal_messages FOR SELECT TO authenticated
  USING (public.is_internal_member(auth.uid(), conversation_id) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "int_msg_insert"
  ON public.internal_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_internal_member(auth.uid(), conversation_id)
  );

CREATE POLICY "int_msg_update_author"
  ON public.internal_messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (sender_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "int_msg_delete_author"
  ON public.internal_messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Trigger : bump updated_at + notifications
CREATE OR REPLACE FUNCTION public.notify_new_internal_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE conv_title text;
BEGIN
  SELECT COALESCE(NULLIF(titre,''), 'Conversation interne') INTO conv_title
    FROM public.internal_conversations WHERE id = NEW.conversation_id;
  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT m.user_id, 'internal_message',
         'Nouveau message interne',
         LEFT(COALESCE(NEW.content, 'Pièce jointe'), 140),
         '/admin/internal-messages/'||NEW.conversation_id
    FROM public.internal_conversation_members m
   WHERE m.conversation_id = NEW.conversation_id
     AND m.user_id <> NEW.sender_id;
  UPDATE public.internal_conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_new_internal_message ON public.internal_messages;
CREATE TRIGGER trg_notify_new_internal_message
AFTER INSERT ON public.internal_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_new_internal_message();

-- Realtime pour les messages internes
ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_messages;
