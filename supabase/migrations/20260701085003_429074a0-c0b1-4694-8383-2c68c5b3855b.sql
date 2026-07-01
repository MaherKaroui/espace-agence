
-- Audit logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read audit logs" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'));
CREATE POLICY "Users can insert their own audit rows" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX audit_logs_action_idx ON public.audit_logs (action);
CREATE INDEX audit_logs_severity_idx ON public.audit_logs (severity);

-- Security settings (singleton)
CREATE TABLE public.security_settings (
  id INT PRIMARY KEY DEFAULT 1,
  mask_phones BOOLEAN NOT NULL DEFAULT true,
  mask_emails BOOLEAN NOT NULL DEFAULT true,
  filter_keywords BOOLEAN NOT NULL DEFAULT true,
  blocked_keywords TEXT[] NOT NULL DEFAULT ARRAY['whatsapp','telegram','signal','viber','messenger','hors plateforme','hors-plateforme','en dehors','contactez-moi sur','mon numero','mon numéro'],
  business_hours_only BOOLEAN NOT NULL DEFAULT false,
  business_hours_start TIME NOT NULL DEFAULT '08:00',
  business_hours_end TIME NOT NULL DEFAULT '19:00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT security_settings_singleton CHECK (id = 1)
);
GRANT SELECT ON public.security_settings TO authenticated;
GRANT ALL ON public.security_settings TO service_role;
ALTER TABLE public.security_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read security settings" ON public.security_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/Direction can update security settings" ON public.security_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'));
CREATE POLICY "Admin/Direction can insert security settings" ON public.security_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'));

INSERT INTO public.security_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Sanitize function
CREATE OR REPLACE FUNCTION public.sanitize_message_content(_content TEXT)
RETURNS TABLE(sanitized TEXT, flagged BOOLEAN, reasons TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s TEXT := COALESCE(_content,'');
  cfg RECORD;
  kw TEXT;
  r TEXT[] := ARRAY[]::TEXT[];
  f BOOLEAN := false;
BEGIN
  SELECT * INTO cfg FROM public.security_settings WHERE id = 1;
  IF cfg IS NULL THEN
    RETURN QUERY SELECT s, false, r; RETURN;
  END IF;
  IF cfg.mask_phones AND s ~ '(\+?\d[\d\s().-]{7,}\d)' THEN
    s := regexp_replace(s, '(\+?\d[\d\s().-]{7,}\d)', '[numéro masqué]', 'g');
    r := array_append(r, 'phone'); f := true;
  END IF;
  IF cfg.mask_emails AND s ~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})' THEN
    s := regexp_replace(s, '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})', '[e-mail masqué]', 'gi');
    r := array_append(r, 'email'); f := true;
  END IF;
  IF cfg.filter_keywords THEN
    FOREACH kw IN ARRAY cfg.blocked_keywords LOOP
      IF s ILIKE '%'||kw||'%' THEN
        s := regexp_replace(s, kw, '[***]', 'gi');
        r := array_append(r, 'keyword:'||kw); f := true;
      END IF;
    END LOOP;
  END IF;
  RETURN QUERY SELECT s, f, r;
END; $$;

-- Trigger: sanitize + audit messages
CREATE OR REPLACE FUNCTION public.on_message_insert_security()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE res RECORD;
BEGIN
  IF NEW.content IS NOT NULL THEN
    SELECT * INTO res FROM public.sanitize_message_content(NEW.content);
    NEW.content := res.sanitized;
    IF res.flagged THEN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
      VALUES (NEW.sender_id, 'message.flagged', 'message', NEW.id, 'warning',
        jsonb_build_object('reasons', res.reasons, 'client_id', NEW.client_id));
    END IF;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (NEW.sender_id, 'message.sent', 'message', NEW.id, 'info',
    jsonb_build_object('client_id', NEW.client_id, 'from_agence', NEW.from_agence, 'has_attachment', NEW.attachment_path IS NOT NULL));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_message_security ON public.messages;
CREATE TRIGGER trg_message_security BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.on_message_insert_security();

-- Audit document uploads
CREATE OR REPLACE FUNCTION public.on_document_insert_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'document.uploaded', 'document', NEW.id, 'info',
    jsonb_build_object('dossier_id', NEW.dossier_id, 'nom', NEW.nom, 'from_agence', NEW.from_agence));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_document_audit ON public.documents;
CREATE TRIGGER trg_document_audit AFTER INSERT ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.on_document_insert_audit();

-- RPC to log document downloads from client
CREATE OR REPLACE FUNCTION public.log_document_download(_document_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'document.downloaded', 'document', _document_id, 'info', '{}'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.log_document_download(UUID) TO authenticated;

-- RPC generic log
CREATE OR REPLACE FUNCTION public.log_event(_action TEXT, _entity_type TEXT, _entity_id UUID, _severity TEXT, _metadata JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), _action, _entity_type, _entity_id, COALESCE(_severity,'info'), COALESCE(_metadata,'{}'::jsonb));
END; $$;
GRANT EXECUTE ON FUNCTION public.log_event(TEXT,TEXT,UUID,TEXT,JSONB) TO authenticated;
