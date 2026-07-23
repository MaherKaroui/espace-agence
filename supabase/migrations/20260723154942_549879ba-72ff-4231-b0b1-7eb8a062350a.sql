
CREATE OR REPLACE FUNCTION public.qualiopi_auto_color()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c TEXT := lower(regexp_replace(coalesce(NEW.certifier_name,'') || ' ' || coalesce(NEW.certifier_organization,''), '\s+', '', 'g'));
  auto TEXT := NULL;
BEGIN
  IF NEW.color_manual IS TRUE THEN
    RETURN NEW;
  END IF;
  -- Priority: CAPCERT > BCI > QUALIPRO > ICPF > WECERT > AFNOR
  IF position('capcert' in c) > 0 THEN auto := 'vert';
  ELSIF position('bci' in c) > 0 THEN auto := 'bleu';
  ELSIF position('qualipro' in c) > 0 THEN auto := 'violet';
  ELSIF position('icpf' in c) > 0 THEN auto := 'orange';
  ELSIF position('wecert' in c) > 0 THEN auto := 'rouge';
  ELSIF position('afnor' in c) > 0 THEN auto := 'gris';
  END IF;
  NEW.color_tag := auto;
  RETURN NEW;
END;
$function$;

-- Backfill: recalc all non-manual rows
UPDATE public.qualiopi_calendar_events
SET color_tag = CASE
  WHEN position('capcert'  in lower(regexp_replace(coalesce(certifier_name,'')||' '||coalesce(certifier_organization,''),'\s+','','g'))) > 0 THEN 'vert'
  WHEN position('bci'      in lower(regexp_replace(coalesce(certifier_name,'')||' '||coalesce(certifier_organization,''),'\s+','','g'))) > 0 THEN 'bleu'
  WHEN position('qualipro' in lower(regexp_replace(coalesce(certifier_name,'')||' '||coalesce(certifier_organization,''),'\s+','','g'))) > 0 THEN 'violet'
  WHEN position('icpf'     in lower(regexp_replace(coalesce(certifier_name,'')||' '||coalesce(certifier_organization,''),'\s+','','g'))) > 0 THEN 'orange'
  WHEN position('wecert'   in lower(regexp_replace(coalesce(certifier_name,'')||' '||coalesce(certifier_organization,''),'\s+','','g'))) > 0 THEN 'rouge'
  WHEN position('afnor'    in lower(regexp_replace(coalesce(certifier_name,'')||' '||coalesce(certifier_organization,''),'\s+','','g'))) > 0 THEN 'gris'
  ELSE NULL
END
WHERE color_manual IS NOT TRUE;
