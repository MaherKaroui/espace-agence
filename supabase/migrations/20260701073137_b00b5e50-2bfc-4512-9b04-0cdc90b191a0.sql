
-- Enums
CREATE TYPE public.app_role AS ENUM ('client', 'admin');
CREATE TYPE public.dossier_categorie AS ENUM ('qualiopi','bpf','nda','cfa','vae','edof','contrats','documents_administratifs','autres');
CREATE TYPE public.dossier_statut AS ENUM ('en_attente','documents_manquants','en_cours_etude','en_cours_traitement','a_completer','valide','refuse','termine');
CREATE TYPE public.notification_type AS ENUM ('message','document_depose','document_valide','document_refuse','document_demande','statut_change','commentaire','compte_active','email_verifie','rappel','action_requise');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nom TEXT NOT NULL DEFAULT '',
  prenom TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Policies profiles
CREATE POLICY "profiles_select_self_or_admin" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles_update_self_or_admin" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Policies user_roles
CREATE POLICY "user_roles_select_self_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- Dossiers
CREATE TABLE public.dossiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  categorie public.dossier_categorie NOT NULL,
  titre TEXT NOT NULL,
  description TEXT,
  statut public.dossier_statut NOT NULL DEFAULT 'en_attente',
  avancement INT NOT NULL DEFAULT 0 CHECK (avancement BETWEEN 0 AND 100),
  commentaire_agence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.dossiers(client_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dossiers TO authenticated;
GRANT ALL ON public.dossiers TO service_role;
ALTER TABLE public.dossiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dossiers_select" ON public.dossiers FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "dossiers_insert_client" ON public.dossiers FOR INSERT TO authenticated
  WITH CHECK (client_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "dossiers_update" ON public.dossiers FOR UPDATE TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "dossiers_delete_admin" ON public.dossiers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- Documents
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id UUID NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  taille BIGINT,
  mime_type TEXT,
  statut TEXT NOT NULL DEFAULT 'en_attente',
  commentaire TEXT,
  from_agence BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.documents(dossier_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents_select" ON public.documents FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM public.dossiers d WHERE d.id = dossier_id AND d.client_id = auth.uid())
  );
CREATE POLICY "documents_insert" ON public.documents FOR INSERT TO authenticated
  WITH CHECK (
    uploader_id = auth.uid() AND (
      public.has_role(auth.uid(),'admin')
      OR EXISTS (SELECT 1 FROM public.dossiers d WHERE d.id = dossier_id AND d.client_id = auth.uid())
    )
  );
CREATE POLICY "documents_update_admin" ON public.documents FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "documents_delete" ON public.documents FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR uploader_id = auth.uid());

-- Messages (conversation: client <-> agence, groupée par client_id)
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_agence BOOLEAN NOT NULL DEFAULT false,
  content TEXT,
  attachment_path TEXT,
  attachment_name TEXT,
  attachment_mime TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.messages(client_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "messages_insert_client" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid() AND (
      (client_id = auth.uid() AND from_agence = false)
      OR (public.has_role(auth.uid(),'admin') AND from_agence = true)
    )
  );
CREATE POLICY "messages_update_read" ON public.messages FOR UPDATE TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Typing indicator (ephemeral via realtime broadcast; no table needed) — noop

-- Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.notification_type NOT NULL,
  titre TEXT NOT NULL,
  message TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.notifications(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "notifications_insert_admin_or_self" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_dossiers_updated_at BEFORE UPDATE ON public.dossiers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- handle_new_user: création profil + attribution rôle
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  admin_emails TEXT[] := ARRAY['maherkr77@gmail.com'];
  assigned_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, nom, prenom, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nom',''),
    COALESCE(NEW.raw_user_meta_data->>'prenom',''),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email = ANY(admin_emails) THEN
    assigned_role := 'admin';
  ELSE
    assigned_role := 'client';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Notifications: nouveau message
CREATE OR REPLACE FUNCTION public.notify_new_message() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE recipient UUID;
BEGIN
  IF NEW.from_agence THEN
    recipient := NEW.client_id;
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (recipient, 'message', 'Nouveau message de l''agence', LEFT(COALESCE(NEW.content,'Pièce jointe'),140), '/messages');
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT ur.user_id, 'message', 'Nouveau message client', LEFT(COALESCE(NEW.content,'Pièce jointe'),140), '/admin/messages/'||NEW.client_id
    FROM public.user_roles ur WHERE ur.role='admin';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_notify_new_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.notify_new_message();

-- Notifications: nouveau document
CREATE OR REPLACE FUNCTION public.notify_new_document() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE client UUID;
BEGIN
  SELECT client_id INTO client FROM public.dossiers WHERE id = NEW.dossier_id;
  IF NEW.from_agence THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (client, 'document_depose', 'Nouveau document de l''agence', NEW.nom, '/dossiers/'||NEW.dossier_id);
  ELSE
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT ur.user_id, 'document_depose', 'Nouveau document déposé', NEW.nom, '/admin/dossiers/'||NEW.dossier_id
    FROM public.user_roles ur WHERE ur.role='admin';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_notify_new_document AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.notify_new_document();

-- Notifications: changement statut dossier
CREATE OR REPLACE FUNCTION public.notify_dossier_status() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    VALUES (NEW.client_id, 'statut_change', 'Statut du dossier mis à jour', NEW.titre||' : '||NEW.statut::text, '/dossiers/'||NEW.id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_notify_dossier_status AFTER UPDATE ON public.dossiers FOR EACH ROW EXECUTE FUNCTION public.notify_dossier_status();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dossiers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
