CREATE OR REPLACE FUNCTION public.save_push_subscription(
  _endpoint text,
  _p256dh text,
  _auth text,
  _user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;
  IF COALESCE(NULLIF(_endpoint, ''), '') = '' OR COALESCE(NULLIF(_p256dh, ''), '') = '' OR COALESCE(NULLIF(_auth, ''), '') = '' THEN
    RAISE EXCEPTION 'Abonnement push incomplet';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.push_subscriptions
    WHERE endpoint = _endpoint AND user_id <> auth.uid()
  ) THEN
    RAISE EXCEPTION 'Cet appareil est déjà lié à un autre compte. Rechargez la page puis réactivez les notifications navigateur.';
  END IF;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
  VALUES (auth.uid(), _endpoint, _p256dh, _auth, _user_agent, now())
  ON CONFLICT (endpoint) DO UPDATE SET
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    last_used_at = now()
  WHERE public.push_subscriptions.user_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text) TO authenticated, service_role;