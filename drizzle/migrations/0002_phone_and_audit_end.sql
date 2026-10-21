ALTER TABLE public.client_acces ADD COLUMN IF NOT EXISTS telephone text;
ALTER TABLE public.qualiopi_calendar_events ADD COLUMN IF NOT EXISTS audit_date_end timestamptz;