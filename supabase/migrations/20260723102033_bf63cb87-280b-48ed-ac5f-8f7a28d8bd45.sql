
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON public.push_subscriptions(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subs_owner_all" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Trigger: on notification insert, fan-out via pg_net to our push route.
-- The route is idempotent and best-effort; failures do NOT block the insert.
CREATE OR REPLACE FUNCTION public.trg_notify_push_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text := 'https://project--51e3d791-7911-46e0-8fee-3de01cd0ad09.lovable.app/api/public/hooks/push-fanout';
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object(
        'notification_id', NEW.id,
        'user_id', NEW.user_id,
        'type', NEW.type,
        'titre', NEW.titre,
        'message', NEW.message
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never block notification insert on push fanout errors
    NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_notify_push_fanout() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notifications_push_fanout ON public.notifications;
CREATE TRIGGER notifications_push_fanout
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_push_fanout();
