CREATE OR REPLACE FUNCTION public.test_push_notification_for_user(_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;