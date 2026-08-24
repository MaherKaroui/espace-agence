CREATE TABLE public.slack_membres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_user_id text NOT NULL UNIQUE,
  nom text,
  display_name text,
  email text,
  avatar_url text,
  is_bot boolean NOT NULL DEFAULT false,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.slack_canaux (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_channel_id text NOT NULL UNIQUE,
  nom text NOT NULL,
  type text NOT NULL DEFAULT 'public',
  sujet text,
  description text,
  membres_count integer NOT NULL DEFAULT 0,
  messages_count integer NOT NULL DEFAULT 0,
  slack_created_at timestamptz,
  client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  rapprochement_valide boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slack_canaux_client_idx ON public.slack_canaux (client_id);

CREATE TABLE public.slack_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_id uuid NOT NULL REFERENCES public.slack_canaux(id) ON DELETE CASCADE,
  slack_channel_id text NOT NULL,
  ts text NOT NULL,
  thread_ts text,
  slack_user_id text,
  auteur text,
  texte text,
  reactions jsonb NOT NULL DEFAULT '[]'::jsonb,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  posted_at timestamptz,
  recherche tsvector GENERATED ALWAYS AS (
    to_tsvector('french', coalesce(texte, '') || ' ' || coalesce(auteur, ''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slack_channel_id, ts)
);
CREATE INDEX slack_messages_canal_idx ON public.slack_messages (canal_id, posted_at DESC);
CREATE INDEX slack_messages_recherche_idx ON public.slack_messages USING gin (recherche);
CREATE INDEX slack_messages_thread_idx ON public.slack_messages (thread_ts);

CREATE TABLE public.slack_fichiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_file_id text NOT NULL UNIQUE,
  canal_id uuid REFERENCES public.slack_canaux(id) ON DELETE CASCADE,
  message_ts text,
  nom text,
  mimetype text,
  taille bigint NOT NULL DEFAULT 0,
  url_private text,
  storage_path text,
  downloaded_at timestamptz,
  erreur text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slack_fichiers_canal_idx ON public.slack_fichiers (canal_id);

CREATE TABLE public.slack_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_nom text NOT NULL,
  statut text NOT NULL DEFAULT 'en_cours',
  canaux_count integer NOT NULL DEFAULT 0,
  membres_count integer NOT NULL DEFAULT 0,
  messages_count integer NOT NULL DEFAULT 0,
  fichiers_count integer NOT NULL DEFAULT 0,
  fichiers_taille bigint NOT NULL DEFAULT 0,
  date_min date,
  date_max date,
  fichiers_traites jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slack_membres TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slack_canaux TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slack_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slack_fichiers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slack_imports TO authenticated;
GRANT ALL ON public.slack_membres TO service_role;
GRANT ALL ON public.slack_canaux TO service_role;
GRANT ALL ON public.slack_messages TO service_role;
GRANT ALL ON public.slack_fichiers TO service_role;
GRANT ALL ON public.slack_imports TO service_role;

ALTER TABLE public.slack_membres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_canaux ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_fichiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "slack_membres_staff" ON public.slack_membres FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "slack_canaux_staff" ON public.slack_canaux FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "slack_messages_staff" ON public.slack_messages FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "slack_fichiers_staff" ON public.slack_fichiers FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "slack_imports_staff" ON public.slack_imports FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER slack_membres_touch BEFORE UPDATE ON public.slack_membres
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER slack_canaux_touch BEFORE UPDATE ON public.slack_canaux
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER slack_imports_touch BEFORE UPDATE ON public.slack_imports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "slack_fichiers_bucket_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'slack-fichiers' AND public.is_staff(auth.uid()));
CREATE POLICY "slack_fichiers_bucket_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'slack-fichiers' AND public.is_staff(auth.uid()));
CREATE POLICY "slack_fichiers_bucket_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'slack-fichiers' AND public.is_staff(auth.uid()));