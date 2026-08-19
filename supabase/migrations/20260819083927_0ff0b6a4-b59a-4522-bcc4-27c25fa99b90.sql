DROP TABLE IF EXISTS public.agency_task_reminders_sent;
ALTER TABLE public.agency_tasks DROP COLUMN IF EXISTS reminders_enabled;