## Mode éphémère — plan d'implémentation

Fonctionnalité type Instagram/WhatsApp : les messages disparaissent automatiquement après une durée choisie par conversation.

### 1. Portée

L'app a 3 systèmes de messagerie. Le mode éphémère sera ajouté aux 3 pour rester cohérent :

- **`messages`** — conversation client ↔ agence (1:1 privée)
- **`conversations` / `group_messages`** — groupes de discussion
- **`internal_conversations` / `internal_messages`** — messagerie interne staff (directs + groupes)

### 2. Schéma base de données

Ajout sur les 3 tables de conversations :
- `ephemeral_enabled boolean default false`
- `ephemeral_duration_seconds int` (nullable)
- `ephemeral_members_can_edit boolean default false` (groupes uniquement — sinon seul l'admin/owner modifie)

Ajout sur les 3 tables de messages :
- `expires_at timestamptz` (nullable, indexé)
- `is_system boolean default false` (pour les messages système "Mode éphémère activé…")

Pour `messages` (client↔agence) qui n'a pas de table conversation dédiée : stockage des réglages éphémères dans une nouvelle table `client_ephemeral_settings(client_id, enabled, duration_seconds)` — la "conversation" est identifiée par `client_id`.

Trigger `BEFORE INSERT` sur chaque table de messages : si le mode est activé sur la conversation, calcule `expires_at = now() + duration`.

### 3. Suppression automatique

Cron job pg_cron toutes les minutes qui :
1. Sélectionne les messages où `expires_at < now()`.
2. Récupère les `attachment_path` associés.
3. Supprime les fichiers du bucket `chat-files` (via `net.http_post` vers une route TSS `/api/public/hooks/purge-ephemeral` qui utilise `supabaseAdmin` + Storage API).
4. `DELETE` en cascade les messages (les réponses/threads sont déjà supprimées via `ON DELETE CASCADE` sur `parent_message_id`).

### 4. Interface utilisateur

- **Header conversation** : bandeau discret "🔥 Mode éphémère · 24 h" quand actif.
- **Icône ⏳** à côté des messages éphémères + tooltip "Disparaît dans XX".
- **Bouton "Paramètres"** ouvrant un `Sheet`/`Dialog` avec :
  - Switch Activé / Désactivé
  - Select durée : 5 min, 30 min, 1 h, 6 h, 12 h, 24 h, 3 j, 7 j, 30 j, Personnalisé
  - (Groupes) Checkbox admin : "Les membres peuvent modifier"
- **Message système** inséré à chaque changement : "Mode éphémère activé — messages supprimés après 24 h."

Utilisation des composants existants : `Sheet`, `Switch`, `Select`, `Dialog`, `Badge` (shadcn déjà installés).

### 5. Permissions

- **1:1 privé** (client↔agence, direct interne) : chaque participant peut modifier.
- **Groupe** : owner + admin toujours ; membres seulement si `ephemeral_members_can_edit = true`.
- Enforcement via RLS `UPDATE` policies sur les tables conversations.

### 6. Fichiers modifiés / créés

**Migration** (1 fichier) : colonnes, index sur `expires_at`, table `client_ephemeral_settings`, triggers `set_expires_at`, RLS policies, pg_cron.

**Backend** :
- `src/routes/api/public/hooks/purge-ephemeral.ts` — route appelée par le cron, supprime fichiers Storage + messages.

**Frontend** — nouveau composant réutilisable :
- `src/components/ephemeral-settings-dialog.tsx` — le Sheet de réglages
- `src/components/ephemeral-header-badge.tsx` — bandeau header + icône message

**Intégration** dans les 3 fenêtres de chat existantes :
- `src/components/chat-window.tsx`
- `src/components/group-chat-window.tsx`
- `src/components/internal-chat-window.tsx` (si présent, sinon dans `admin.internal-messages.$id.tsx`)
- `src/routes/_authenticated/messages.groupes.$id.tsx` — ajout du bouton dans le header

### 7. UX

- Suppression invisible côté utilisateur (le message disparaît juste de la liste au rafraîchissement realtime).
- Fonctionne sur texte, images, vidéos, documents, messages vocaux (tous stockés via `attachment_path`).
- Realtime déjà en place : les DELETE sont propagés automatiquement.

### Notes techniques

- Les fichiers supprimés du bucket sont retirés définitivement (pas de corbeille).
- Les threads/réactions/reads : `ON DELETE CASCADE` déjà configuré sur les FK.
- Le cron traite max 500 messages par exécution pour éviter les timeouts.
