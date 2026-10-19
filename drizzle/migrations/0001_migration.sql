DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';
SELECT cron.schedule('purge-cron-history', '30 3 * * *', $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days'$$);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON public.notifications (user_id) WHERE read_at IS NULL;
DROP INDEX IF EXISTS public.idx_notifications_user_created;
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at DESC);