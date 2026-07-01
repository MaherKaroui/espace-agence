# SPEC — Évolutions récentes

Application interne (TanStack Start + Supabase / Lovable Cloud). Interface en français.
Les évolutions ci-dessous complètent le cahier des charges initial.

## 1. Notifications pop-up temps réel (tous événements)

- Table existante `notifications` (user_id, type, titre, message, link, read_at, created_at).
- Table `notification_preferences` (user_id, event_type, enabled) — préférences par utilisateur.
- Composant global `NotificationsRealtime` monté dans `AppShell` (donc uniquement pour les utilisateurs
  authentifiés) : abonnement Realtime sur `notifications` filtré par `user_id=auth.uid()`, filtrage
  côté client selon les préférences, affichage `toast` (sonner, coin haut-droit), regroupement anti-spam
  (fenêtre 4 s par couple type+link).
- Catégories d'événements : chat, document, tâche, RDV, sécurité (admin/direction seulement).
- Centre de notifications (`/notifications`) et cloche (`NotificationsBell`) déjà en place — historique
  persistant, marquage lu.
- Page `/preferences` : activer/désactiver par catégorie.
- Respect strict des droits : les inserts dans `notifications` sont faits par les triggers serveur qui
  ciblent le bon destinataire (client concerné, admins/direction pour les alertes, etc.). Les alertes
  sécurité (`rapport_quotidien`, mots-clés) ne partent qu'aux rôles direction/admin.

## 2. Suppression de messages — réservée à l'admin

- Colonnes ajoutées sur `messages` : `deleted_at`, `deleted_by`.
- Table immuable `message_deletion_log` : `deleted_message_id`, `deleted_by`, `deleted_at`,
  `original_author_id`, `client_id`, `content_hash` (SHA-256), `content_length`.
  - Lecture réservée à admin/direction (RLS).
  - Aucune policy INSERT/UPDATE/DELETE → seul le trigger `SECURITY DEFINER` peut écrire.
- Policy `messages_update_admin_delete` : seul l'admin peut passer `deleted_at`.
- Trigger `on_message_soft_delete` (BEFORE UPDATE) :
  - vérifie `has_role(auth.uid(),'admin')` (double garde en plus de la RLS),
  - insère la ligne dans `message_deletion_log` avec le hash du contenu original,
  - purge `content`, `attachment_path`, `attachment_name`, `attachment_mime`,
  - alimente `audit_logs` (severity `warning`, action `message.deleted`).
- Front (`ChatWindow`) : bouton `Supprimer` visible uniquement pour `isAdmin`, confirmation via
  `AlertDialog`. Le message supprimé s'affiche en tombstone :
  « Message supprimé par la direction le [date] ».
- Aucune fonction "modifier un message" — édition non prévue, incompatible avec la traçabilité.

## 3. Lecteur vidéo intégré

- Colonnes ajoutées sur `documents` : `duration_seconds`, `thumbnail_path`.
- Bucket privé `document-thumbnails` (RLS : lecture selon droits du document, upload staff, delete admin).
- Bucket privé existant `documents` : streaming via `createSignedUrl` (durée limitée 15 min), pas d'URL
  publique.
- Composant `VideoPlayer` : détection `mime_type` commençant par `video/`, ouverture dans un `Dialog`
  avec `<video controls controlsList="nodownload">`, streaming depuis l'URL signée.
- Journalisation : à l'ouverture du lecteur, appel `rpc('log_event', {...})` avec action
  `video.viewed` → trace « qui, quand, quel fichier » dans `audit_logs`. Le simple visionnage streaming
  ne vaut pas téléchargement mais reste tracé. Le téléchargement continue d'appeler `log_document_download`.
- Vignette dans la liste des documents (bouton `Play` sur miniature) lorsque `thumbnail_path` est présent.
- Les vidéos jointes au chat sont également lues inline (`<video>` HTML5 via URL signée).

## Modèle de sécurité conservé

- RLS activée sur toutes les tables `public.*`.
- Bearer Supabase transmis aux server functions via `attachSupabaseAuth` déjà configuré dans `src/start.ts`.
- Historique de chat immuable pour tout rôle autre qu'admin (`messages_no_delete` bloque le DELETE dur ;
  la « suppression admin » est un soft-delete tracé et non un DELETE SQL).
