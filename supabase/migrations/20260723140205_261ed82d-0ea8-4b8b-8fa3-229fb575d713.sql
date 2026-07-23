
-- ============================================================
-- LOT B : Chat cloisonné auditeur/certificateur sur dossier
-- LOT C : Demandes de pièces Qualiopi par indicateur
-- ============================================================

-- 1) Nouveau type de conversation 'external' (dossier <-> intervenants externes)
ALTER TABLE public.internal_conversations DROP CONSTRAINT IF EXISTS internal_conversations_type_check;
ALTER TABLE public.internal_conversations ADD CONSTRAINT internal_conversations_type_check
  CHECK (type = ANY (ARRAY['direct','pole','client','dossier','task','custom','group','channel','announcement','external']));

CREATE UNIQUE INDEX IF NOT EXISTS internal_conversations_external_unique
  ON public.internal_conversations(dossier_id) WHERE type = 'external' AND dossier_id IS NOT NULL;

-- 2) Étendre la fonction de visibilité pour inclure les affectés (auditeur/certificateur)
CREATE OR REPLACE FUNCTION public.can_view_internal_conv(_user uuid, _conv uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_user, 'admin'::app_role)
    OR public.has_role(_user, 'direction'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.internal_conversation_members
       WHERE conversation_id = _conv AND user_id = _user
    )
    OR EXISTS (
      SELECT 1 FROM public.internal_conversations c
       WHERE c.id = _conv
         AND c.type = 'pole'
         AND c.pole_id IS NOT NULL
         AND public.is_pole_member(_user, c.pole_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.internal_conversations c
       WHERE c.id = _conv
         AND c.type = 'external'
         AND c.dossier_id IS NOT NULL
         AND (
           public.dossier_in_scope(_user, c.dossier_id)
           OR public.is_assigned_to_dossier(_user, c.dossier_id)
         )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.can_view_internal_conv(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_internal_conv(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- LOT C : Qualiopi Requests
-- ============================================================

CREATE TABLE IF NOT EXISTS public.qualiopi_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dossier_id UUID NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  indicator_id INT NOT NULL REFERENCES public.qualiopi_indicators(id),
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  message TEXT,
  statut TEXT NOT NULL DEFAULT 'en_attente'
    CHECK (statut IN ('en_attente','deposee','validee','refusee')),
  refus_motif TEXT,
  due_date DATE,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qualiopi_requests_dossier ON public.qualiopi_requests(dossier_id);
CREATE INDEX IF NOT EXISTS idx_qualiopi_requests_indicator ON public.qualiopi_requests(indicator_id);
CREATE INDEX IF NOT EXISTS idx_qualiopi_requests_statut ON public.qualiopi_requests(statut);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qualiopi_requests TO authenticated;
GRANT ALL ON public.qualiopi_requests TO service_role;
ALTER TABLE public.qualiopi_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.qualiopi_request_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES public.qualiopi_requests(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  version INT NOT NULL DEFAULT 1,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  sha256 TEXT,
  antivirus_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (antivirus_status IN ('pending','clean','infected','error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qualiopi_req_docs_request ON public.qualiopi_request_documents(request_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qualiopi_request_documents TO authenticated;
GRANT ALL ON public.qualiopi_request_documents TO service_role;
ALTER TABLE public.qualiopi_request_documents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.qualiopi_request_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES public.qualiopi_requests(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qualiopi_req_events_request ON public.qualiopi_request_events(request_id);
GRANT SELECT, INSERT ON public.qualiopi_request_events TO authenticated;
GRANT ALL ON public.qualiopi_request_events TO service_role;
ALTER TABLE public.qualiopi_request_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.qualiopi_dossier_participant(_user uuid, _dossier uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_user, 'admin'::app_role)
    OR public.has_role(_user, 'direction'::app_role)
    OR public.dossier_in_scope(_user, _dossier)
    OR public.is_assigned_to_dossier(_user, _dossier)
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = _dossier AND d.client_id = _user
    );
$$;
REVOKE EXECUTE ON FUNCTION public.qualiopi_dossier_participant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qualiopi_dossier_participant(uuid, uuid) TO authenticated, service_role;

-- RLS qualiopi_requests
DROP POLICY IF EXISTS "qualiopi_requests_read" ON public.qualiopi_requests;
CREATE POLICY "qualiopi_requests_read" ON public.qualiopi_requests
  FOR SELECT TO authenticated
  USING (public.qualiopi_dossier_participant(auth.uid(), dossier_id));

DROP POLICY IF EXISTS "qualiopi_requests_insert" ON public.qualiopi_requests;
CREATE POLICY "qualiopi_requests_insert" ON public.qualiopi_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND (
      public.dossier_in_scope(auth.uid(), dossier_id)
      OR public.is_assigned_to_dossier(auth.uid(), dossier_id)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'direction'::app_role)
    )
  );

DROP POLICY IF EXISTS "qualiopi_requests_update" ON public.qualiopi_requests;
CREATE POLICY "qualiopi_requests_update" ON public.qualiopi_requests
  FOR UPDATE TO authenticated
  USING (public.qualiopi_dossier_participant(auth.uid(), dossier_id))
  WITH CHECK (public.qualiopi_dossier_participant(auth.uid(), dossier_id));

DROP POLICY IF EXISTS "qualiopi_requests_delete" ON public.qualiopi_requests;
CREATE POLICY "qualiopi_requests_delete" ON public.qualiopi_requests
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
    OR requested_by = auth.uid()
  );

-- RLS qualiopi_request_documents
DROP POLICY IF EXISTS "qualiopi_req_docs_read" ON public.qualiopi_request_documents;
CREATE POLICY "qualiopi_req_docs_read" ON public.qualiopi_request_documents
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.qualiopi_requests r
    WHERE r.id = qualiopi_request_documents.request_id
      AND public.qualiopi_dossier_participant(auth.uid(), r.dossier_id)
  ));

DROP POLICY IF EXISTS "qualiopi_req_docs_insert" ON public.qualiopi_request_documents;
CREATE POLICY "qualiopi_req_docs_insert" ON public.qualiopi_request_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.qualiopi_requests r
      WHERE r.id = qualiopi_request_documents.request_id
        AND public.qualiopi_dossier_participant(auth.uid(), r.dossier_id)
    )
  );

DROP POLICY IF EXISTS "qualiopi_req_docs_delete" ON public.qualiopi_request_documents;
CREATE POLICY "qualiopi_req_docs_delete" ON public.qualiopi_request_documents
  FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'direction'::app_role)
  );

-- RLS qualiopi_request_events (append-only)
DROP POLICY IF EXISTS "qualiopi_req_events_read" ON public.qualiopi_request_events;
CREATE POLICY "qualiopi_req_events_read" ON public.qualiopi_request_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.qualiopi_requests r
    WHERE r.id = qualiopi_request_events.request_id
      AND public.qualiopi_dossier_participant(auth.uid(), r.dossier_id)
  ));

DROP POLICY IF EXISTS "qualiopi_req_events_insert" ON public.qualiopi_request_events;
CREATE POLICY "qualiopi_req_events_insert" ON public.qualiopi_request_events
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.qualiopi_requests r
      WHERE r.id = qualiopi_request_events.request_id
        AND public.qualiopi_dossier_participant(auth.uid(), r.dossier_id)
    )
  );

CREATE OR REPLACE FUNCTION public.qualiopi_requests_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_qualiopi_requests_touch ON public.qualiopi_requests;
CREATE TRIGGER trg_qualiopi_requests_touch BEFORE UPDATE ON public.qualiopi_requests
  FOR EACH ROW EXECUTE FUNCTION public.qualiopi_requests_touch();

-- Storage policies (bucket 'qualiopi-files' already exists — private, 500 Mo)
DROP POLICY IF EXISTS "qualiopi_files_select" ON storage.objects;
CREATE POLICY "qualiopi_files_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'qualiopi-files'
    AND EXISTS (
      SELECT 1 FROM public.qualiopi_requests r
      WHERE r.id = (split_part(name, '/', 1))::uuid
        AND public.qualiopi_dossier_participant(auth.uid(), r.dossier_id)
    )
  );

DROP POLICY IF EXISTS "qualiopi_files_insert" ON storage.objects;
CREATE POLICY "qualiopi_files_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'qualiopi-files'
    AND EXISTS (
      SELECT 1 FROM public.qualiopi_requests r
      WHERE r.id = (split_part(name, '/', 1))::uuid
        AND public.qualiopi_dossier_participant(auth.uid(), r.dossier_id)
    )
  );

DROP POLICY IF EXISTS "qualiopi_files_delete" ON storage.objects;
CREATE POLICY "qualiopi_files_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'qualiopi-files'
    AND (
      owner = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'direction'::app_role)
    )
  );
