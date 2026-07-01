## Objectif
Afficher **« Vu »** et la **date/heure de lecture** sous les messages envoyés, dans la messagerie 1-à-1 (client ↔ agence) et dans les groupes.

## Constat
- `messages` (1-à-1) a déjà une colonne `read_at` — utilisée nulle part côté UI.
- `group_messages` n'a **pas** de suivi de lecture — il faut le créer par destinataire.

## Étapes

### 1. Base de données (migration)
- **`messages`** : rien à créer (colonne `read_at` déjà là).
- **`group_message_reads`** (nouvelle table) :
  - `message_id uuid` → `group_messages.id` (cascade)
  - `user_id uuid` → `auth.users.id`
  - `read_at timestamptz default now()`
  - PK = (`message_id`, `user_id`)
  - GRANT `SELECT, INSERT` à `authenticated`, `ALL` à `service_role`
  - RLS : un membre de la conversation peut lire les read-receipts de ses messages, et n'insère que sa propre ligne (`user_id = auth.uid()` + `is_conversation_member(auth.uid(), conv_of_message)`).

### 2. Marquage « lu » (côté client)
- **`ChatWindow`** (1-à-1) : quand la conversation est ouverte et visible, `UPDATE messages SET read_at = now() WHERE client_id = ... AND read_at IS NULL AND sender_id <> auth.uid()` (RLS déjà OK côté destinataire).
- **`GroupChatWindow`** : `INSERT INTO group_message_reads (message_id, user_id)` pour les messages visibles non encore lus par l'utilisateur courant (`ON CONFLICT DO NOTHING`).
- Déclenché à l'ouverture + à chaque nouveau message reçu via realtime.

### 3. Affichage « Vu … » sous les messages envoyés (`isMine`)
- **1-à-1** : sous le message si `read_at` non nul → `✓✓ Vu · 01/07/2026 15:04`. Sinon `✓ Envoyé`.
- **Groupes** : charger les `group_message_reads` liés aux messages affichés. Sous chaque message envoyé :
  - `✓✓ Vu par N/M · dernière lecture 15:04` avec tooltip listant les noms + horodatage.
  - Sinon `✓ Envoyé`.
- Petit texte gris, sous la bulle, taille `text-[11px]`.

### 4. Realtime
- S'abonner aux `UPDATE` sur `messages` et aux `INSERT` sur `group_message_reads` pour rafraîchir l'indicateur en direct chez l'expéditeur.

## Fichiers touchés
- **Migration** : nouvelle table `group_message_reads` + policies.
- **Code** :
  - `src/components/chat-window.tsx` (marquer lu + afficher « Vu »)
  - `src/components/group-chat-window.tsx` (idem + fetch des reads)
  - Éventuellement un petit helper `src/lib/read-receipts.ts`.

## Hors périmètre
- Pas d'accusé de lecture pour les messages supprimés.
- Pas de désactivation « masquer que j'ai lu » (peut être ajouté plus tard via `notification_preferences`).
