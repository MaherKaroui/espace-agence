
-- Poles
CREATE TABLE public.poles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  nom TEXT NOT NULL,
  description TEXT,
  couleur TEXT NOT NULL DEFAULT '#1E2761',
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.poles TO authenticated;
GRANT ALL ON public.poles TO service_role;

ALTER TABLE public.poles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER poles_updated_at BEFORE UPDATE ON public.poles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Read poles" ON public.poles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Direction manages poles" ON public.poles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));

-- Pole memberships
CREATE TYPE public.pole_role AS ENUM ('manager', 'consultant');

CREATE TABLE public.pole_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pole_id UUID NOT NULL REFERENCES public.poles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.pole_role NOT NULL DEFAULT 'consultant',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pole_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pole_members TO authenticated;
GRANT ALL ON public.pole_members TO service_role;

ALTER TABLE public.pole_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Direction manages memberships" ON public.pole_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'direction'));

CREATE POLICY "Users see own memberships" ON public.pole_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Helpers
CREATE OR REPLACE FUNCTION public.is_pole_member(_user_id UUID, _pole_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.pole_members WHERE user_id = _user_id AND pole_id = _pole_id);
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','direction','manager','consultant')
  );
$$;

-- Seed
INSERT INTO public.poles (code, nom, description, couleur) VALUES
  ('juridique',    'Juridique',    'Contrats, statuts, conformité juridique',        '#1E2761'),
  ('nda',          'NDA',          'Numéro de Déclaration d''Activité',              '#065A82'),
  ('qualiopi',     'Qualiopi',     'Certification Qualiopi (audit initial et suivi)', '#028090'),
  ('audit',        'Audit',        'Préparation et suivi des audits',                '#6D2E46'),
  ('edof',         'EDOF',         'Référencement EDOF et CPF',                      '#B85042'),
  ('controle',     'Contrôle',     'Contrôles administratifs (BPF, DREETS…)',        '#2C5F2D'),
  ('certification','Certification','Certifications professionnelles / France Compétences','#36454F'),
  ('autres',       'Autres',       'Autres démarches administratives',                '#84B59F')
ON CONFLICT (code) DO NOTHING;

-- Attach dossiers to poles
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS pole_id UUID REFERENCES public.poles(id);

UPDATE public.dossiers d SET pole_id = p.id
FROM public.poles p
WHERE d.pole_id IS NULL AND (
  (d.categorie::text = 'qualiopi'                  AND p.code = 'qualiopi') OR
  (d.categorie::text = 'nda'                       AND p.code = 'nda')      OR
  (d.categorie::text = 'bpf'                       AND p.code = 'controle') OR
  (d.categorie::text = 'cfa'                       AND p.code = 'certification') OR
  (d.categorie::text = 'vae'                       AND p.code = 'certification') OR
  (d.categorie::text = 'edof'                      AND p.code = 'edof')     OR
  (d.categorie::text = 'contrats'                  AND p.code = 'juridique')OR
  (d.categorie::text = 'documents_administratifs'  AND p.code = 'autres')   OR
  (d.categorie::text = 'autres'                    AND p.code = 'autres')
);

UPDATE public.dossiers d SET pole_id = p.id
FROM public.poles p
WHERE d.pole_id IS NULL AND p.code = 'autres';

ALTER TABLE public.dossiers ALTER COLUMN pole_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS dossiers_pole_id_idx ON public.dossiers(pole_id);

-- Extended dossier RLS: staff sees dossiers of their poles
CREATE POLICY "Staff read dossiers of their poles" ON public.dossiers FOR SELECT TO authenticated
  USING (public.is_pole_member(auth.uid(), pole_id));

CREATE POLICY "Staff update dossiers of their poles" ON public.dossiers FOR UPDATE TO authenticated
  USING (public.is_pole_member(auth.uid(), pole_id))
  WITH CHECK (public.is_pole_member(auth.uid(), pole_id));

-- Give existing admin the direction role too
INSERT INTO public.user_roles (user_id, role)
SELECT ur.user_id, 'direction'::public.app_role
FROM public.user_roles ur
WHERE ur.role = 'admin'
ON CONFLICT (user_id, role) DO NOTHING;

-- Future admins get direction automatically
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  admin_emails TEXT[] := ARRAY['maherkr77@gmail.com'];
BEGIN
  INSERT INTO public.profiles (id, nom, prenom, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nom',''),
    COALESCE(NEW.raw_user_meta_data->>'prenom',''),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email = ANY(admin_emails) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'direction')
      ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END; $$;
