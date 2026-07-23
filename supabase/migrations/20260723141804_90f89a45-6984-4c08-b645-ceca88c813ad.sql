
-- Lot D: Qualiopi notifications, reminders, cron

-- 1) Enum values (added one by one, IF NOT EXISTS)
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'qualiopi_message';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'qualiopi_demande';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'qualiopi_document';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'qualiopi_validation';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'qualiopi_refus';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'qualiopi_echeance';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'qualiopi_retard';

-- 2) Reminder column
ALTER TABLE public.qualiopi_requests ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;
