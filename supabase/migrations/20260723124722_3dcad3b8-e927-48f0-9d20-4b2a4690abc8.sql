CREATE OR REPLACE FUNCTION public.team_notification_recipients_for_pole(
  _pole_id uuid,
  _exclude_user_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH active_pole_recipients AS (
    SELECT DISTINCT pm.user_id
    FROM public.pole_members pm
    JOIN public.profiles pr ON pr.id = pm.user_id
    JOIN public.user_roles ur ON ur.user_id = pm.user_id
    WHERE _pole_id IS NOT NULL
      AND pm.pole_id = _pole_id
      AND pr.archived_at IS NULL
      AND ur.role IN (
        'manager'::public.app_role,
        'consultant'::public.app_role,
        'admin'::public.app_role,
        'direction'::public.app_role
      )
  ),
  fallback_recipients AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE NOT EXISTS (SELECT 1 FROM active_pole_recipients)
      AND ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
      AND pr.archived_at IS NULL
  )
  SELECT apr.user_id FROM active_pole_recipients apr
  UNION
  SELECT fr.user_id FROM fallback_recipients fr;
$$;

CREATE OR REPLACE FUNCTION public.team_notification_recipients_for_client(
  _client_id uuid,
  _exclude_user_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH active_pole_recipients AS (
    SELECT DISTINCT pm.user_id
    FROM public.dossiers d
    JOIN public.pole_members pm ON pm.pole_id = d.pole_id
    JOIN public.profiles pr ON pr.id = pm.user_id
    JOIN public.user_roles ur ON ur.user_id = pm.user_id
    WHERE d.client_id = _client_id
      AND pm.user_id <> _client_id
      AND pr.archived_at IS NULL
      AND ur.role IN (
        'manager'::public.app_role,
        'consultant'::public.app_role,
        'admin'::public.app_role,
        'direction'::public.app_role
      )
  ),
  fallback_recipients AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE NOT EXISTS (SELECT 1 FROM active_pole_recipients)
      AND ur.user_id <> _client_id
      AND ur.role IN ('admin'::public.app_role, 'direction'::public.app_role)
      AND pr.archived_at IS NULL
  )
  SELECT apr.user_id FROM active_pole_recipients apr
  UNION
  SELECT fr.user_id FROM fallback_recipients fr;
$$;

REVOKE ALL ON FUNCTION public.team_notification_recipients_for_pole(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_notification_recipients_for_client(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_notification_recipients_for_pole(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_notification_recipients_for_client(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.test_push_notification_for_user(_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_notification_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'direction'::public.app_role)) THEN
    RAISE EXCEPTION 'Réservé à la direction / administration';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE ur.user_id = _user_id
      AND ur.role IN ('admin'::public.app_role, 'direction'::public.app_role, 'manager'::public.app_role, 'consultant'::public.app_role)
      AND pr.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Membre équipe introuvable ou désactivé';
  END IF;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  VALUES (
    _user_id,
    'alerte_securite'::public.notification_type,
    'Test notifications IZISuivis',
    'Si le push navigateur est actif, cette notification doit aussi apparaître sur le PC.',
    '/notifications'
  )
  RETURNING id INTO v_notification_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'push.test_sent', 'user', _user_id, 'info', jsonb_build_object('notification_id', v_notification_id));

  RETURN v_notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.test_push_notification_for_pole(_pole_id uuid)
RETURNS TABLE(notification_id uuid, user_id uuid, push_subscriptions_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pole_name text;
  v_count integer;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'direction'::public.app_role)) THEN
    RAISE EXCEPTION 'Réservé à la direction / administration';
  END IF;

  SELECT nom INTO v_pole_name
  FROM public.poles
  WHERE id = _pole_id AND actif = true;

  IF v_pole_name IS NULL THEN
    RAISE EXCEPTION 'Pôle introuvable ou inactif';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_notification_recipients_for_pole(_pole_id, NULL);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Aucun membre actif trouvé pour ce pôle';
  END IF;

  RETURN QUERY
  WITH inserted AS (
    INSERT INTO public.notifications (user_id, type, titre, message, link)
    SELECT r.user_id,
      'alerte_securite'::public.notification_type,
      'Test notifications pôle ' || v_pole_name,
      'Test équipe : cloche interne pour tous, push navigateur pour les membres activés.',
      '/notifications'
    FROM public.team_notification_recipients_for_pole(_pole_id, NULL) r
    RETURNING id, user_id
  )
  SELECT i.id,
         i.user_id,
         COALESCE((SELECT count(*)::integer FROM public.push_subscriptions ps WHERE ps.user_id = i.user_id), 0)
  FROM inserted i;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'push.test_pole_sent', 'pole', _pole_id, 'info', jsonb_build_object('pole_nom', v_pole_name, 'recipients', v_count));
END;
$$;

REVOKE ALL ON FUNCTION public.test_push_notification_for_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.test_push_notification_for_pole(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.test_push_notification_for_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.test_push_notification_for_pole(uuid) TO authenticated, service_role;