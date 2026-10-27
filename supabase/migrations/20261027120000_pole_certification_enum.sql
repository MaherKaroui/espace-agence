-- Pôle Certification & EDOF : types de notification (ajout seul, aucune valeur existante modifiée).
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'pc_etape';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'pc_refus';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'pc_echeance';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'pc_retard';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'pc_document';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'pc_rappel';
