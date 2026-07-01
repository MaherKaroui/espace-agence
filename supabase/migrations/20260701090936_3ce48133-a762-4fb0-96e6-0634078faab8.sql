
-- Lot A: Manager/Consultant roles scoped by pôle
-- Fix RLS so staff (manager/consultant) see dossiers/taches/messages/documents ONLY of their pôles.
-- Direction/admin keep full access.

-- ============= DOSSIERS =============
-- Direction voit tout
DROP POLICY IF EXISTS "dossiers_select_direction" ON public.dossiers;
CREATE POLICY "dossiers_select_direction" ON public.dossiers
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'));

DROP POLICY IF EXISTS "dossiers_update_direction" ON public.dossiers;
CREATE POLICY "dossiers_update_direction" ON public.dossiers
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'));

DROP POLICY IF EXISTS "dossiers_insert_staff" ON public.dossiers;
CREATE POLICY "dossiers_insert_staff" ON public.dossiers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'direction')
    OR public.is_pole_member(auth.uid(), pole_id)
  );

-- ============= TACHES =============
-- Retire l'accès "staff tout voir"; scope par pôle
DROP POLICY IF EXISTS "Staff voit toutes les tâches" ON public.taches;
DROP POLICY IF EXISTS "Staff gère les tâches" ON public.taches;

CREATE POLICY "taches_select_pole_staff" ON public.taches
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'direction')
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = taches.dossier_id
        AND public.is_pole_member(auth.uid(), d.pole_id)
    )
  );

CREATE POLICY "taches_write_pole_staff" ON public.taches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'direction')
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = taches.dossier_id
        AND public.is_pole_member(auth.uid(), d.pole_id)
    )
  );

CREATE POLICY "taches_update_pole_staff" ON public.taches
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'direction')
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = taches.dossier_id
        AND public.is_pole_member(auth.uid(), d.pole_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = taches.dossier_id AND d.client_id = auth.uid()
    )
  );

CREATE POLICY "taches_delete_direction" ON public.taches
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'direction'));

-- ============= MESSAGES =============
-- Staff pôle peut voir les messages des dossiers de leurs pôles
DROP POLICY IF EXISTS "messages_select_pole_staff" ON public.messages;
CREATE POLICY "messages_select_pole_staff" ON public.messages
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'direction')
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.client_id = messages.client_id
        AND public.is_pole_member(auth.uid(), d.pole_id)
    )
  );

DROP POLICY IF EXISTS "messages_insert_staff" ON public.messages;
CREATE POLICY "messages_insert_staff" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Client s'envoie à lui-même
    (sender_id = auth.uid() AND client_id = auth.uid())
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'direction')
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.client_id = messages.client_id
        AND public.is_pole_member(auth.uid(), d.pole_id)
    )
  );

-- Historique non-modifiable : personne ne peut supprimer
DROP POLICY IF EXISTS "messages_no_delete" ON public.messages;
CREATE POLICY "messages_no_delete" ON public.messages
  FOR DELETE TO authenticated USING (false);

-- ============= DOCUMENTS =============
-- Insert scopé (client sur ses dossiers ; staff pôle ; direction)
DROP POLICY IF EXISTS "documents_insert" ON public.documents;
CREATE POLICY "documents_insert_scoped" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'direction')
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = documents.dossier_id
        AND (d.client_id = auth.uid() OR public.is_pole_member(auth.uid(), d.pole_id))
    )
  );

-- Update: staff pôle peut mettre à jour (versioning à venir)
DROP POLICY IF EXISTS "documents_update_admin" ON public.documents;
DROP POLICY IF EXISTS "documents_update_staff" ON public.documents;
CREATE POLICY "documents_update_staff" ON public.documents
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'direction')
    OR EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = documents.dossier_id
        AND public.is_pole_member(auth.uid(), d.pole_id)
    )
  );
