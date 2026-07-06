# Système de gestion des tâches internes — Tableau de bord agence

## Objectif
Ajouter un vrai module de gestion des tâches internes à `/admin` (Vue agence) : création, priorités, assignation, échéances, notifications, RLS. Distinct des `taches` existantes (qui sont liées au workflow client d'un dossier).

## 1. Base de données (migration)

### Nouveaux enums
- `agency_task_priority` : `basse` | `normale` | `haute` | `urgente`
- `agency_task_status` : `a_faire` | `en_cours` | `bloquee` | `terminee`

### Table `agency_tasks`
Champs métier : `title`, `description`, `priority` (défaut `normale`), `status` (défaut `a_faire`), `due_date`, `created_by`, `assigned_to`, `pole_id`, `client_id` (optionnel), `dossier_id` (optionnel), `attachment_path`, `attachment_name`, `internal_comment`, `completed_at`, `archived_at`.

### Table `agency_task_comments`
`task_id`, `user_id`, `content`.

### Type de notification
Ajouter `agency_task` à l'enum `notification_type`.

### Grants + RLS (règles)
- **Voir** : admin/direction voient tout. Manager/consultant voient les tâches de leurs pôles OU assignées à eux OU créées par eux. Client : rien.
- **Créer** : admin/direction partout. Manager uniquement dans ses pôles.
- **Modifier** : admin/direction, créateur, assigné, ou membre du pôle (manager).
- **Archiver/supprimer définitivement** : admin/direction uniquement.
- **Commentaires** : lisibles/écrits par qui peut voir la tâche.

### Triggers
- `updated_at` auto.
- Notification à l'assigné à la création/réassignation (type `agency_task`, lien `/admin/taches-agence`).
- Audit log : `agency_task.created`, `.updated`, `.status_changed`, `.completed`, `.archived`.
- `completed_at` auto à la transition vers `terminee`.

## 2. Backend server functions
`src/lib/agency-tasks.functions.ts` (protégées `requireSupabaseAuth`) :
- `listAgencyTasks` (filtres : bucket, priority, status, assigned_to, pole_id)
- `createAgencyTask`
- `updateAgencyTask` (statut, priorité, assigné, échéance, contenu)
- `archiveAgencyTask`
- `addTaskComment` / `listTaskComments`
- `getAgencyTaskKpis` (compteurs jour/urgentes/retard/terminées semaine, par collaborateur, par pôle)

Le RLS fait le vrai gardiennage ; les server fns exposent juste les requêtes typées.

## 3. UI

### `/admin` (Vue agence) — ajouts
- 4 nouvelles cartes KPI : Aujourd'hui · Urgentes · En retard · Terminées cette semaine.
- Nouveau bloc **« Priorités du jour »** : tableau trié (urgente+retard > urgente > haute > échéance proche > normale > basse), badge couleur priorité (rouge/orange/bleu/gris), badge statut, personne assignée, pôle, échéance. Actions rapides : changer statut, ouvrir détail.
- Bouton **« Créer une tâche »** (admin/direction/manager) → dialog.

### Nouvelle route `/admin/taches-agence`
Vue complète avec onglets : Urgentes · Aujourd'hui · En retard · Mes tâches · Mon équipe · Terminées · Archivées. Filtres pôle / assigné / priorité / statut. Tableau + drawer détail (commentaires, historique, actions).

### Composants
- `agency-task-badge.tsx` (priorité + statut, couleurs sémantiques via tokens)
- `agency-task-form-dialog.tsx` (création/édition)
- `agency-task-detail-drawer.tsx` (détail + commentaires + actions)
- `agency-tasks-priority-board.tsx` (bloc dashboard)

### Navigation
Ajouter « Tâches agence » dans `staffNav` (visible manager+, badge nombre à faire assignées à moi).

## 4. Notifications
- À la création avec `assigned_to` : row dans `notifications` (type `agency_task`, lien vers la route).
- À la réassignation : notif au nouvel assigné.
- Badge sur l'entrée de nav utilise le count via `notifications` (déjà géré par `app-shell`).
- Alerte visuelle « en retard » calculée côté client (`due_date < now()` et statut non terminé).

## 5. Sécurité
- RLS strictes basées sur `has_role` + `is_pole_member` (déjà existants).
- Tous les server fns passent par `requireSupabaseAuth`.
- Client : aucune policy ne les inclut → tables invisibles.
- Attachements : réutiliser le bucket `documents` avec un préfixe `agency-tasks/<task_id>/`.

## 6. Détails techniques
- Enum `notification_type` étendu via `ALTER TYPE ... ADD VALUE` dans migration.
- Index : `(assigned_to, status)`, `(pole_id, status)`, `(due_date) WHERE archived_at IS NULL`.
- Tri « priorité du jour » côté SQL via CASE.

## Critères de validation
Admin crée/assigne une tâche, elle apparaît chez l'assigné, priorités colorées, tâches urgentes/retard en tête, RLS bloque les non-autorisés, notifications reçues, workflow jusqu'à `terminee` fonctionne, archivage OK.
