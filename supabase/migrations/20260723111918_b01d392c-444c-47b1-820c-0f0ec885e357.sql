CREATE OR REPLACE FUNCTION public.backfill_missing_auto_dossier_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_before integer := 0;
  v_after integer := 0;
BEGIN
  SELECT count(*) INTO v_before
  FROM public.dossiers d
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.agency_tasks t
    WHERE t.dossier_id = d.id AND t.task_type = 'nouveau_dossier'
  );

  INSERT INTO public.agency_tasks (
    title,
    description,
    priority,
    status,
    due_date,
    created_by,
    assigned_to,
    pole_id,
    client_id,
    dossier_id,
    auto,
    task_type
  )
  WITH admin_user AS (
    SELECT user_id
    FROM public.user_roles
    WHERE role = 'admin'
    ORDER BY id ASC
    LIMIT 1
  ), missing AS (
    SELECT
      d.id AS dossier_id,
      d.titre,
      d.client_id,
      d.pole_id,
      d.organisme_nom,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', pr.prenom, pr.nom)), ''), pr.email) AS client_name,
      p.nom AS pole_nom,
      COALESCE(pm_manager.user_id, pm_consultant.user_id, au.user_id, d.client_id) AS assigned_to,
      COALESCE(au.user_id, d.client_id) AS created_by
    FROM public.dossiers d
    LEFT JOIN public.profiles pr ON pr.id = d.client_id
    LEFT JOIN public.poles p ON p.id = d.pole_id
    CROSS JOIN admin_user au
    LEFT JOIN LATERAL (
      SELECT user_id
      FROM public.pole_members
      WHERE pole_id = d.pole_id AND role = 'manager'
      ORDER BY created_at ASC
      LIMIT 1
    ) pm_manager ON true
    LEFT JOIN LATERAL (
      SELECT user_id
      FROM public.pole_members
      WHERE pole_id = d.pole_id AND role = 'consultant'
      ORDER BY created_at ASC
      LIMIT 1
    ) pm_consultant ON true
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.agency_tasks t
      WHERE t.dossier_id = d.id AND t.task_type = 'nouveau_dossier'
    )
  )
  SELECT
    'Nouveau dossier à traiter — ' || titre,
    'Client : ' || COALESCE(client_name, '—') || E'\n' ||
    'Organisme de formation : ' || COALESCE(NULLIF(TRIM(organisme_nom), ''), 'Nom OF manquant') || E'\n' ||
    'Pôle : ' || COALESCE(pole_nom, '—') || E'\n\n' ||
    'Merci de prendre en charge le dossier sous 24h.',
    'normale',
    'a_faire',
    now() + interval '1 day',
    created_by,
    assigned_to,
    pole_id,
    client_id,
    dossier_id,
    true,
    'nouveau_dossier'
  FROM missing
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_after
  FROM public.dossiers d
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.agency_tasks t
    WHERE t.dossier_id = d.id AND t.task_type = 'nouveau_dossier'
  );

  v_count := GREATEST(v_before - v_after, 0);
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.backfill_missing_auto_dossier_tasks() FROM PUBLIC, anon, authenticated;