-- 1) Authorization check inside qualiopi_notify_all
CREATE OR REPLACE FUNCTION public.qualiopi_notify_all(_dossier uuid, _except uuid, _type notification_type, _titre text, _message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.qualiopi_dossier_participant(auth.uid(), _dossier) THEN
    RAISE EXCEPTION 'not authorized for this dossier';
  END IF;

  FOR r IN
    SELECT user_id FROM public.qualiopi_dossier_recipients(_dossier)
    WHERE (_except IS NULL OR user_id <> _except)
  LOOP
    INSERT INTO public.notifications(user_id, type, titre, message, link)
    VALUES (r.user_id, _type, _titre, _message, public.qualiopi_link_for(r.user_id, _dossier));
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.qualiopi_notify_all(uuid, uuid, notification_type, text, text) FROM PUBLIC, anon;

-- 2) Send the internal service key as bearer to the push fan-out endpoint
CREATE OR REPLACE FUNCTION public.trg_notify_push_fanout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := 'https://izisuivis.com/api/public/hooks/push-fanout';
  v_key text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1;
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || coalesce(v_key,'')),
      body := jsonb_build_object('notification_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.trg_notify_push_fanout() FROM PUBLIC, anon, authenticated;

-- 3) Cron jobs: authenticate to the hook endpoints
DO $$
DECLARE v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1;

  PERFORM cron.unschedule('purge-ephemeral-messages');
  PERFORM cron.schedule('purge-ephemeral-messages', '*/10 * * * *', format($cmd$
    SELECT net.http_post(
      url := 'https://project--51e3d791-7911-46e0-8fee-3de01cd0ad09.lovable.app/api/public/hooks/purge-ephemeral',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
      body := '{}'::jsonb
    );
  $cmd$, v_key));

  PERFORM cron.unschedule('izisuivis-reminders');
  PERFORM cron.schedule('izisuivis-reminders', '0 * * * *', format($cmd$
    SELECT net.http_post(
      url := 'https://project--51e3d791-7911-46e0-8fee-3de01cd0ad09.lovable.app/api/public/hooks/reminders',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
      body := '{}'::jsonb
    );
  $cmd$, v_key));
END $$;