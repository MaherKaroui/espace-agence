# Pilotage Direction — refonte complète

Objectif : transformer `/admin/direction` en vrai outil de pilotage quotidien exploitable par la direction, avec rapport détaillé par personne, contenu des messages, archives et exports.

## 1. Base de données

### Nouvelle table `daily_direction_reports`
- `report_date` (unique)
- `generated_by` (uuid → auth.users)
- `summary_json` (KPIs globaux du jour)
- `user_reports_json` (activité détaillée par utilisateur)
- `pole_reports_json`, `client_reports_json`
- `messages_count`, `documents_count`, `dossiers_modified_count`, `relances_count`, `active_users_count`

RLS : SELECT + INSERT réservés à `admin` / `direction` (via `has_role`).
GRANT SELECT, INSERT à `authenticated` ; ALL à `service_role`.

### RPC `generer_rapport_direction(_date date)`
- SECURITY DEFINER, vérifie `has_role(auth.uid(), 'admin'|'direction')` sinon RAISE.
- Agrège depuis `audit_logs`, `messages`, `internal_messages`, `group_messages`, `documents`, `dossiers`, `taches`, `client_notes`, `user_sessions` pour `_date`.
- Regroupe par `user_id` : première/dernière activité, compteurs par type d'action, durée de session.
- Regroupe par pôle et par client.
- Upsert dans `daily_direction_reports` et renvoie l'id.

### Nouveaux logs d'audit manquants
Ajouter des inserts `log_event(...)` pour les actions actuellement non tracées :
- `dossier.viewed` (côté client sur ouverture — via server fn dédié)
- `dossier.updated` / `dossier.status_changed` (triggers sur `dossiers`)
- `document.validated` / `document.rejected` (trigger sur update `documents.statut`)
- `client_note.added` (trigger sur insert `client_notes`)
- `rendezvous.created` / `rendezvous.updated` (trigger sur `rendez_vous`)
- `user.session_started` (déjà via `session_start`, ajouter un log)

## 2. Backend — server functions

`src/lib/direction-report.functions.ts` protégé par `requireSupabaseAuth` + check role admin/direction :
- `generateDailyReport({ date })` → appelle la RPC, renvoie le rapport.
- `getReport({ date })` → lit `daily_direction_reports`.
- `listReports({ from, to })` → liste archivée.
- `getUserActivityDetail({ date, userId })` → timeline chronologique depuis `audit_logs` + jointures pour enrichir (titre dossier, nom client, contenu message).
- `getMessagesForDay({ date, userId?, type? })` → messages/internal/group avec auteur, destinataire, dossier, contenu, pièces jointes.
- `exportReportCSV({ date })` / `exportReportPDF({ date })` → renvoient string CSV / buffer PDF.

Toutes ces fonctions vérifient le rôle en début de handler.

## 3. Frontend — `/admin/direction`

Refonte de la page en onglets :

**Onglet "Aujourd'hui"**
- Bandeau KPIs : actions totales, messages, documents, dossiers modifiés, relances, clients actifs, staff actif, tâches en retard, alertes.
- Graphiques : activité par heure (barres), activité par pôle, activité par collaborateur, dossiers par statut, docs déposés/validés/refusés.
- Top clients actifs, dossiers bloqués/en retard.
- Bouton **"Générer le rapport du jour"** fonctionnel (invalide les queries et affiche le rapport).

**Onglet "Rapport par personne"**
- Tableau des utilisateurs actifs du jour : nom, rôle, pôle, 1re activité, dernière activité, #actions, #messages, #docs, #dossiers consultés/modifiés, #relances, #notes, temps de connexion.
- Bouton "Voir le détail" → dialog avec timeline chronologique (heure + action + contexte : dossier/client/message).

**Onglet "Messages du jour"**
- Liste unifiée messages client / interne / groupe avec auteur, destinataire, type, date, dossier lié, contenu, pièces jointes.
- Filtres : utilisateur, type.

**Onglet "Rapports archivés"**
- Liste des rapports (date, généré par, #actions, #personnes actives).
- Boutons Voir / Export CSV / Export PDF.

**Filtres globaux** en haut : date, pôle, utilisateur, rôle, type d'action, client, dossier.

## 4. Sécurité

- Gate route `beforeLoad` : redirect si pas admin/direction (déjà partiellement fait).
- Toutes les server functions revérifient le rôle.
- RLS sur `daily_direction_reports` scopée à admin/direction via `has_role`.
- Aucune donnée sensible (contenu messages) ne transite hors des server functions autorisées.

## 5. Exports

- CSV : construit côté server function, retourné en string, téléchargé côté client via Blob.
- PDF : utiliser `pdf-lib` (compatible Worker) pour générer un PDF simple listant KPIs, tableau par personne, messages. Retour base64.

## 6. Fichiers touchés

**Migrations**
- `create_daily_direction_reports.sql` (table + RLS + RPC `generer_rapport_direction` + triggers audit manquants).

**Backend**
- `src/lib/direction-report.functions.ts` (nouveau).

**Frontend**
- `src/routes/_authenticated/admin.direction.tsx` (refonte complète).
- `src/components/direction/` : `KpiGrid.tsx`, `UserActivityTable.tsx`, `UserTimelineDialog.tsx`, `MessagesLog.tsx`, `ReportsArchive.tsx`, `DirectionFilters.tsx`.

## Notes techniques

- Timezone : tout calcul quotidien en `Europe/Paris` (tronqué à la date locale).
- Performance : indexer `audit_logs(user_id, created_at)` et `audit_logs(action, created_at)` si absent.
- Le rapport JSON garde tout : pas besoin de rejouer les jointures pour l'affichage archivé.
- Refetch en temps réel toutes les 30s uniquement sur les KPIs live (pas sur le rapport archivé).

Attention : je veux un vrai pilotage direction exploitable, pas seulement des statistiques simples.
