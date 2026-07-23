# Lot D — Finalisation Qualiopi avant publication

Objectif : compléter les 6 points manquants sans casser la messagerie client existante ni les notifications déjà en place.

## 1) Notifications Qualiopi temps réel

Migration SQL :
- Ajouter au type `notification_type` les valeurs : `qualiopi_message`, `qualiopi_demande`, `qualiopi_document`, `qualiopi_validation`, `qualiopi_refus`, `qualiopi_echeance`, `qualiopi_retard`.
- Fonction `qualiopi_dossier_recipients(_dossier uuid)` retournant tous les user_ids autorisés (staff du pôle + admins + direction + auditeurs/certificateurs affectés), utilisée par les triggers.
- Trigger `AFTER INSERT` sur `qualiopi_requests` → notifie tous les destinataires sauf l'auteur (type `qualiopi_demande`).
- Trigger `AFTER INSERT` sur `qualiopi_request_documents` → `qualiopi_document`.
- Trigger `AFTER UPDATE OF statut` sur `qualiopi_requests` → `qualiopi_validation` ou `qualiopi_refus` (avec motif dans le message).
- Trigger `AFTER INSERT` sur `internal_messages` pour conversations `type = 'external'` → `qualiopi_message` (link = `/audits/$id` pour externes, `/admin/dossiers/$id` pour staff, calculé côté fonction serveur qui pousse la notif — ou link générique `/dossiers/$id` accepté par les deux).
- Chaque notification crée une ligne `notifications` (déjà branchée sur email + web push existants via triggers/queues actuelles).

Côté client :
- Étendre `src/lib/notification-types.ts` avec les nouveaux types (icône `ShieldCheck` / `FileText` / `MessageSquare` / `CheckCircle2` / `XCircle` / `Clock`).
- `NotificationsRealtime` prend déjà en charge automatiquement (préférences par catégorie).

Journalisation : `push_delivery_logs` déjà utilisé par le fan-out existant, aucune modification requise.

## 2) Lecture / non-lus conversations externes

Réutiliser l'existant `internal_conversation_members.last_read_at` (déjà présent). Ajouter :
- Server fn `markExternalConversationRead(dossierId)` → met à jour `last_read_at = now()`.
- Server fn `getExternalUnreadCounts()` → map `dossierId → nb messages depuis last_read_at`.
- Dans `DossierExternalChat` : appel `markExternalConversationRead` à l'ouverture et sur nouveau message reçu.
- Dans `/audits` (index) : badge compteur par ligne de dossier.
- Dans la fiche dossier admin (`dossiers.$id.tsx`) : badge total non-lus sur l'onglet/section "Canal d'audit".

## 3) Export rapport Qualiopi

Vue imprimable (route dédiée + bouton dans `QualiopiRequestsPanel`) :
- Nouvelle route `src/routes/_authenticated/dossiers.$id.qualiopi-rapport.tsx` (lecture seule, mise en page A4, styles print).
- Contenu : entête dossier, tableau des demandes par critère/indicateur, statuts, motifs de refus, historique événements, versions de documents (nom + version + date + auteur).
- Bouton "Exporter (imprimer / PDF)" → `window.print()`.
- Bouton "Exporter CSV" → génère un CSV côté client à partir des mêmes données.

## 4) Relances automatiques

- Colonne `due_date` déjà présente sur `qualiopi_requests`, ajouter `last_reminder_at timestamptz`.
- Server function `sendQualiopiReminder(requestId)` : notifie les participants (via helper existant), garde-fou 24h, log dans `qualiopi_request_events` (action `reminder_sent`).
- Bouton "Relancer" dans `QualiopiRequestsPanel` sur chaque demande `en_attente` ou en retard.
- Job pg_cron quotidien (07:00 Europe/Paris) : détecte `due_date - now() < 2 days` (échéance proche) et `due_date < now()` (retard) sur statut `en_attente`, appelle `sendQualiopiReminder` en respectant l'anti-spam.

## 5) Filtres & tri liste Audits

Dans `src/routes/_authenticated/audits.index.tsx` :
- Barre de filtres : statut dossier, client (organisme_nom), rôle (auditeur/certificateur), retard (dossiers avec ≥1 demande en retard).
- Tri : plus récent, échéance la plus proche, retard en premier.
- État conservé en `useState` local + query params.

## 6) Vérification finale

- `tsgo` sur les fichiers modifiés.
- Vérifier les policies RLS existantes (aucun `TO anon` ajouté).
- Rapide fumigation preview : ouvrir `/audits`, `/audits/$id`, `/admin/dossiers/$id`, s'assurer que la messagerie client `/admin/messages` reste intacte.

## Détails techniques

- Migrations dans un seul appel `supabase--migration` (types enum + fonction destinataires + 4 triggers + colonne `last_reminder_at` + cron).
- Aucune modification aux fichiers auto-générés (`client.ts`, `types.ts` sera régénéré après la migration).
- Nouveaux fichiers :
  - `src/lib/qualiopi-notifications.functions.ts` (mark read, unread counts, send reminder).
  - `src/routes/_authenticated/dossiers.$id.qualiopi-rapport.tsx`.
- Fichiers modifiés :
  - `src/lib/notification-types.ts`, `src/components/qualiopi-requests-panel.tsx`, `src/components/dossier-external-chat.tsx`, `src/routes/_authenticated/audits.index.tsx`, `src/routes/_authenticated/audits.$id.tsx`, `src/routes/_authenticated/dossiers.$id.tsx`.

## Livraison

Après approbation : je lance la migration, code les fichiers en parallèle, puis vérifie TypeScript et preview.
