CREATE TABLE IF NOT EXISTS public.notification_reminders_sent (
  kind text NOT NULL,
  entity_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, entity_id)
);
GRANT SELECT ON public.notification_reminders_sent TO authenticated;
GRANT ALL ON public.notification_reminders_sent TO service_role;
ALTER TABLE public.notification_reminders_sent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reminders_admin_read" ON public.notification_reminders_sent
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'direction'::app_role));
CREATE INDEX IF NOT EXISTS notification_reminders_sent_sent_at_idx
  ON public.notification_reminders_sent (sent_at DESC);