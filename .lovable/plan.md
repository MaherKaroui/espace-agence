## Objectif

Ajouter une messagerie de **groupe** (ex : 3 personnes qui discutent ensemble) avec **sous-groupes en arborescence illimitée**. Clients et admins peuvent créer des groupes et y ajouter des membres.

## 1. Base de données (migration)

**Table `conversations`**
- `titre` (text)
- `parent_id` (uuid, FK conversations, nullable) → arborescence libre
- `created_by` (uuid)
- timestamps

**Table `conversation_members`** (PK composite conversation_id + user_id)
- `role` (`owner` | `member`)
- `added_at`

**Table `group_messages`**
- `conversation_id` (FK conversations)
- `sender_id` (uuid)
- `content` (text nullable)
- `attachment_path`, `attachment_name`, `attachment_mime`
- `created_at`, `edited_at`, `deleted_at`, `deleted_by`

**Fonction security-definer** `is_conversation_member(_user_id, _conv_id)` pour éviter la récursion RLS.

**RLS**
- conversations : SELECT si membre ou admin/direction ; INSERT libre pour tout authentifié ; UPDATE/DELETE si owner ou admin
- conversation_members : SELECT si membre de la conversation ; INSERT si owner de la conv ou admin ; DELETE idem
- group_messages : SELECT/INSERT si membre ; UPDATE/DELETE (soft) réservé à l'auteur ou admin

**Notifications** : trigger sur `group_messages` INSERT → notifie tous les membres sauf l'expéditeur (type `message`, lien `/messages/groupes/:id`).

## 2. Interface (nouveau segment `/messages/groupes`)

- **`src/routes/_authenticated/messages.groupes.index.tsx`** : liste arborescente des conversations dont je suis membre (avec repli pour les sous-groupes), bouton **« Nouveau groupe »**.
- **`src/routes/_authenticated/messages.groupes.$id.tsx`** : chat du groupe (réutilise le composant `chat-window` refactoré ou une variante `group-chat-window`) + panneau membres à droite + bouton **« Créer un sous-groupe »** (pré-remplit `parent_id`).
- **Dialogue création** : titre, sélection multiple des clients/staff via recherche sur `profiles`, membres pré-cochés = créateur.
- **Panneau membres** : ajouter/retirer un membre (owner + admin seulement).
- Lien **« Groupes »** ajouté dans la navigation `app-shell`.

## 3. Réutilisation

- Le composant `chat-window.tsx` actuel est fortement lié à `client_id`. Je créerai `group-chat-window.tsx` (copie allégée : messages, upload, vocal, édition/suppression admin) plutôt que de le rendre polymorphe — plus sûr et n'impacte pas la messagerie client↔agence existante.

## 4. Fichiers touchés

- Migration : `conversations`, `conversation_members`, `group_messages`, RLS, fonction, trigger notif
- `src/routes/_authenticated/messages.groupes.index.tsx` (nouveau)
- `src/routes/_authenticated/messages.groupes.$id.tsx` (nouveau)
- `src/components/group-chat-window.tsx` (nouveau, adapté de `chat-window`)
- `src/components/group-create-dialog.tsx` (nouveau)
- `src/components/app-shell.tsx` (lien nav)
- `src/integrations/supabase/types.ts` (régénéré automatiquement)

## 5. Hors périmètre

- Appel audio/vidéo de groupe
- Réactions emoji / fils de réponse
- Recherche full-text dans les conversations
