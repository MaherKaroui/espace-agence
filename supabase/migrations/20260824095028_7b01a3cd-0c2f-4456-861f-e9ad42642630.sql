ALTER TABLE public.qualiopi_calendar_events
  ADD COLUMN IF NOT EXISTS tuteur text,
  ADD COLUMN IF NOT EXISTS notes_suivi text;

ALTER TABLE public.qualiopi_calendar_events
  ALTER COLUMN audit_date DROP NOT NULL;