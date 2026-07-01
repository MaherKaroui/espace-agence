
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS detected_type TEXT,
  ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS detection_confidence NUMERIC;

CREATE INDEX IF NOT EXISTS idx_documents_detected_type ON public.documents(detected_type);
