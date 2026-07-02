UPDATE public.security_settings
SET blocked_keywords = ARRAY[
  'whatsapp','wa','telegram','signal','viber','messenger','snap','snapchat','insta','instagram','dm',
  'gmail','hotmail','outlook','yahoo',
  'num','numero','numéro','tel','telephone','téléphone','portable','mobile',
  'mon num','mon numero','mon numéro','mon tel','mon telephone','mon téléphone','numéro perso','numero perso',
  'appelle-moi','appelle moi','appelez-moi','appelez moi','contactez-moi','contacte-moi',
  'hors plateforme','hors-plateforme','en dehors','en privé','en prive'
]
WHERE id = 1;

CREATE OR REPLACE FUNCTION public.sanitize_message_content(_content TEXT)
RETURNS TABLE(sanitized TEXT, flagged BOOLEAN, reasons TEXT[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s TEXT := COALESCE(_content,'');
  cfg RECORD;
  kw TEXT;
  pat TEXT;
  r TEXT[] := ARRAY[]::TEXT[];
  f BOOLEAN := false;
BEGIN
  SELECT * INTO cfg FROM public.security_settings WHERE id = 1;
  IF cfg IS NULL THEN
    RETURN QUERY SELECT s, false, r; RETURN;
  END IF;
  IF cfg.mask_phones AND s ~ '(\+?\d[\d\s().-]{7,}\d)' THEN
    s := regexp_replace(s, '(\+?\d[\d\s().-]{7,}\d)', '[numéro masqué]', 'g');
    r := array_append(r, 'phone'); f := true;
  END IF;
  IF cfg.mask_emails AND s ~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})' THEN
    s := regexp_replace(s, '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})', '[e-mail masqué]', 'gi');
    r := array_append(r, 'email'); f := true;
  END IF;
  IF cfg.filter_keywords THEN
    FOREACH kw IN ARRAY cfg.blocked_keywords LOOP
      -- Word-boundary match: avoids false positives (e.g. "num" inside "numérique")
      pat := '\m' || regexp_replace(kw, '([.\\+*?()\[\]{}|^$])', '\\\1', 'g') || '\M';
      IF s ~* pat THEN
        s := regexp_replace(s, pat, '[***]', 'gi');
        r := array_append(r, 'keyword:'||kw); f := true;
      END IF;
    END LOOP;
  END IF;
  RETURN QUERY SELECT s, f, r;
END; $$;