-- Le site publié n'accepte pour l'instant que la clé déjà utilisée par les tâches planifiées.
-- On réutilise exactement ce jeton (extrait des jobs cron) pour le déclencheur push.
DO $do$
DECLARE
  v_key text;
BEGIN
  SELECT (regexp_match(command, 'Bearer ([A-Za-z0-9_\-\.]+)'))[1]
    INTO v_key
    FROM cron.job
   WHERE command like '%Bearer %'
   ORDER BY jobid DESC
   LIMIT 1;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'no cron bearer token found';
  END IF;

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.trg_notify_push_fanout()
     RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path TO 'public'
    AS $function$
    DECLARE
      v_url text := 'https://izisuivis.com/api/public/hooks/push-fanout';
      v_key text := %L;
    BEGIN
      BEGIN
        PERFORM net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
          body := jsonb_build_object('notification_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      RETURN NEW;
    END;
    $function$;
  $f$, v_key);

  REVOKE EXECUTE ON FUNCTION public.trg_notify_push_fanout() FROM PUBLIC, anon, authenticated;
END
$do$;