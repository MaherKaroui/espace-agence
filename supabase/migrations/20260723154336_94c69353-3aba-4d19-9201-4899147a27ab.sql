
ALTER TABLE public.qualiopi_calendar_events
  ADD COLUMN IF NOT EXISTS color_tag TEXT,
  ADD COLUMN IF NOT EXISTS color_manual BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.qualiopi_calendar_events
  DROP CONSTRAINT IF EXISTS qualiopi_calendar_events_color_tag_check;
ALTER TABLE public.qualiopi_calendar_events
  ADD CONSTRAINT qualiopi_calendar_events_color_tag_check
  CHECK (color_tag IS NULL OR color_tag IN ('vert','bleu','orange','violet','rouge','gris'));

CREATE OR REPLACE FUNCTION public.qualiopi_auto_color()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a TEXT := lower(regexp_replace(coalesce(NEW.auditor_name, ''), '\s+', '', 'g'));
  c TEXT := lower(regexp_replace(coalesce(NEW.certifier_name, '') || ' ' || coalesce(NEW.certifier_organization, ''), '\s+', '', 'g'));
BEGIN
  IF NEW.color_manual IS TRUE THEN
    RETURN NEW;
  END IF;
  IF position('siby' in a) > 0 AND position('capcert' in c) > 0 THEN
    NEW.color_tag := 'vert';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qualiopi_auto_color() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_qualiopi_auto_color ON public.qualiopi_calendar_events;
CREATE TRIGGER trg_qualiopi_auto_color
  BEFORE INSERT OR UPDATE ON public.qualiopi_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.qualiopi_auto_color();

-- Backfill existing rows
UPDATE public.qualiopi_calendar_events
SET color_tag = 'vert'
WHERE color_manual = FALSE
  AND color_tag IS NULL
  AND lower(coalesce(auditor_name,'')) LIKE '%siby%'
  AND (lower(coalesce(certifier_name,'')) LIKE '%capcert%' OR lower(coalesce(certifier_organization,'')) LIKE '%capcert%');
