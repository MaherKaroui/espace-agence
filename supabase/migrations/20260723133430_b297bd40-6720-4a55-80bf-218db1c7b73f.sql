CREATE OR REPLACE FUNCTION public.notify_team_document_reminder(_document_id uuid, _reminder_type text DEFAULT 'manual')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc record;
  v_count integer := 0;
BEGIN
  SELECT doc.id, doc.nom, doc.dossier_id, d.titre AS dossier_titre, d.pole_id, d.client_id
    INTO v_doc
  FROM public.documents doc
  JOIN public.dossiers d ON d.id = doc.dossier_id
  WHERE doc.id = _document_id;

  IF v_doc.id IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT r.user_id,
    'document_depose'::public.notification_type,
    'Document à vérifier',
    COALESCE(v_doc.dossier_titre || ' · ', '') || v_doc.nom,
    '/admin/dossiers/' || v_doc.dossier_id
  FROM public.team_notification_recipients_for_pole(v_doc.pole_id, v_doc.client_id) r;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'team.document_reminder_notified', 'document', _document_id, 'info', jsonb_build_object('reminder_type', _reminder_type, 'recipients', v_count));

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_team_document_reminder(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_team_document_reminder(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_team_dossier_reminder(_dossier_id uuid, _reminder_type text DEFAULT 'manual')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dossier record;
  v_count integer := 0;
BEGIN
  SELECT id, titre, pole_id, client_id INTO v_dossier
  FROM public.dossiers
  WHERE id = _dossier_id;

  IF v_dossier.id IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notifications (user_id, type, titre, message, link)
  SELECT r.user_id,
    'statut_change'::public.notification_type,
    'Rappel dossier à suivre',
    v_dossier.titre,
    '/admin/dossiers/' || v_dossier.id
  FROM public.team_notification_recipients_for_pole(v_dossier.pole_id, v_dossier.client_id) r;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, severity, metadata)
  VALUES (auth.uid(), 'team.dossier_reminder_notified', 'dossier', _dossier_id, 'info', jsonb_build_object('reminder_type', _reminder_type, 'recipients', v_count));

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_team_dossier_reminder(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_team_dossier_reminder(uuid, text) TO authenticated, service_role;