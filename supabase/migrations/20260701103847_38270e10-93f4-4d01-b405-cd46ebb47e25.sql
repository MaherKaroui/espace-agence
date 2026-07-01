
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.user_sessions TO authenticated;
GRANT ALL ON public.user_sessions TO service_role;

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_own_or_admin" ON public.user_sessions
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'direction')
  );

CREATE POLICY "sessions_insert_own" ON public.user_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "sessions_update_own" ON public.user_sessions
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON public.user_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_open ON public.user_sessions(user_id) WHERE ended_at IS NULL;

-- Ouvre une session pour l'utilisateur courant
CREATE OR REPLACE FUNCTION public.session_start(_user_agent TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;
  INSERT INTO public.user_sessions (user_id, user_agent)
  VALUES (auth.uid(), _user_agent)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- Met à jour last_seen_at (heartbeat)
CREATE OR REPLACE FUNCTION public.session_heartbeat(_session_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_sessions
  SET last_seen_at = now()
  WHERE id = _session_id AND user_id = auth.uid() AND ended_at IS NULL;
END;
$$;

-- Ferme la session et calcule la durée
CREATE OR REPLACE FUNCTION public.session_end(_session_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_sessions
  SET ended_at = now(),
      last_seen_at = now(),
      duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int)
  WHERE id = _session_id AND user_id = auth.uid() AND ended_at IS NULL;
END;
$$;

-- Nettoyage automatique des sessions inactives (>10 min sans heartbeat)
CREATE OR REPLACE FUNCTION public.close_stale_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_sessions
  SET ended_at = last_seen_at,
      duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (last_seen_at - started_at))::int)
  WHERE ended_at IS NULL
    AND last_seen_at < now() - INTERVAL '10 minutes';
END;
$$;
