# Plan — Cloisonnement par pôle & messagerie interne

Objectif : empêcher toute fuite entre pôles (backend + UI), remplacer la suppression client par un archivage, et livrer une messagerie interne agence isolée de la messagerie client.

Réponses retenues :
- Suppression client → **remplacée par un archivage** (admin/direction uniquement).
- Dossiers sans pôle / pôle inactif → **invisibles au staff non-direction** (accès direct = "Accès refusé").
- Messagerie interne V1 → **1-à-1 + groupes + pièces jointes**, isolée des clients.
- Staff dans un pôle → **lecture + écriture** avec les clients de ses pôles.

---

## 1. Migrations base de données

### 1.1 Archivage client (remplace la suppression)
- `profiles.archived_at timestamptz`, `archived_by uuid`, `archive_reason text`.
- Fonction `public.archive_client(_user_id uuid, _reason text)` SECURITY DEFINER, réservée admin/direction, qui :
  - anonymise via la logique existante `anonymize_user_account` (adaptée) ou pose simplement `archived_at`,
  - révoque toutes les sessions actives,
  - journalise dans `audit_logs`.
- Fonction `public.unarchive_client(_user_id uuid)` (admin uniquement).
- Politique RLS `profiles` : le `SELECT` staff exclut les profils archivés sauf pour admin/direction.

### 1.2 Verrouillage des accès par pôle
Ajouter helpers SQL (SECURITY DEFINER, stable, search_path=public) :
- `public.dossier_in_my_scope(_user uuid, _dossier uuid) → boolean` — vrai si admin/direction, sinon si le `pole_id` du dossier appartient à `pole_members` de `_user` **et** le pôle est actif.
- `public.client_in_my_scope(_staff uuid, _client uuid) → boolean` — remplace/complète `staff_can_view_client` : admin/direction OR il existe un dossier du client dans un pôle du staff (pôle actif).

Réécrire les policies suivantes pour utiliser ces helpers :
- `dossiers` (SELECT / UPDATE) : staff non-direction limité à `dossier_in_my_scope`. Un dossier `pole_id IS NULL` ou dont le pôle est inactif est invisible hors admin/direction.
- `documents`, `taches`, `messages` (client_id), `notifications` : `client_in_my_scope` côté staff.
- `profiles` (SELECT staff) : `client_in_my_scope` OR admin/direction.
- `client_notes` : même règle.

### 1.3 Messagerie interne agence
Nouvelles tables (préfixe `internal_` pour ne pas croiser les tables `conversations`/`group_messages` client) :
- `internal_conversations` : `id`, `titre`, `is_group boolean`, `created_by`, `created_at`, `updated_at`.
- `internal_conversation_members` : `conversation_id`, `user_id`, `role ('owner'|'member')`, `joined_at`, `last_read_at`.
- `internal_messages` : `id`, `conversation_id`, `sender_id`, `content`, `attachment_path`, `attachment_name`, `attachment_mime`, `created_at`, `edited_at`, `deleted_at`.

Règles d'appartenance :
- Seuls admin/direction/manager/consultant peuvent participer (fonction `is_agency_member(uuid)`).
- Un consultant ne peut créer une conversation qu'avec : membres de ses pôles + responsables de ses pôles + admin/direction.
- Fonction `public.can_start_internal_conv(_a uuid, _b uuid)` appliquée dans un trigger d'insertion sur `internal_conversation_members`.

RLS : membre = lecture/écriture messages de la conversation, éditeur = uniquement ses propres messages, admin = tout. GRANTs `authenticated` + `service_role` sur les 3 tables.

Nouveau bucket privé `internal-chat-files` + policies sur `storage.objects` limitées aux membres de la conversation (chemin `{conversation_id}/…`).

Trigger `notify_new_internal_message` → insère dans `notifications` (type `internal_message`) pour chaque membre ≠ sender.

---

## 2. Server functions (`createServerFn`, RLS respectée)

- `src/lib/admin-clients.functions.ts` :
  - **Retirer** `deleteClient`. Ajouter `archiveClient({ userId, reason })` et `unarchiveClient({ userId })` (admin/direction pour archive, admin pour désarchivage). Vérif rôle via `has_role`.
  - `inviteClient` inchangé mais refuse si le futur dossier n'appartient pas au périmètre du caller.
- `src/lib/internal-messages.functions.ts` (nouveau) :
  - `listInternalConversations`, `createInternalConversation({ memberIds, titre? })`, `sendInternalMessage`, `markInternalConversationRead`, `listAllowedInternalContacts` (renvoie les contacts autorisés selon les pôles du caller).

Toutes protégées par `requireSupabaseAuth` + double vérif rôle/pôle.

---

## 3. UI

### 3.1 Renommages
- `/admin/dossiers` : titre "Dossiers de mes pôles" (déjà en place, on garde).
- `/admin/clients` : titre "Clients de mes pôles" (staff non-direction).
- `/admin/messages` : titre "Messagerie clients".
- Nouvelle route `/admin/internal-messages` : "Messagerie interne".

### 3.2 Filtrage frontend (défense en profondeur, pas la seule barrière)
- `/admin/dossiers` : la requête reste identique — RLS filtre déjà. On enlève le bloc "Sans pôle actif" pour les non-direction.
- `/admin/clients` : requête filtrée côté serveur (RLS) ; l'UI se contente d'afficher ce que la DB renvoie.
- `/admin/clients/$id` :
  - `beforeLoad` appelle une serverFn `assertClientAccess(clientId)` qui throw `notFound()` si hors périmètre → page "Accès refusé".
  - Section "Zone dangereuse" : bouton **Archiver** (admin/direction) au lieu de Supprimer. Le bouton supprimer disparaît complètement du DOM ; le serverFn `deleteClient` n'existe plus.
- `/admin/dossiers/$id` (redirect actuel) : ajouter un check côté `/dossiers/$id` : si staff non-direction ET dossier hors périmètre → `notFound()`.
- `/admin/messages/$clientId` : `beforeLoad` refuse si `client_in_my_scope` est faux.

### 3.3 Menu (`app-shell.tsx`)
- Cacher "Clients", "Messagerie clients" pour les rôles sans dossier accessible (mais RLS garde le dernier mot).
- Ajouter l'entrée "Messagerie interne" pour tous les staff.

### 3.4 Messagerie interne (nouvelles pages)
- `/admin/internal-messages` : liste des conversations internes + bouton "Nouvelle conversation" (sélection de contacts filtrée par `listAllowedInternalContacts`).
- `/admin/internal-messages/$id` : fenêtre de chat (réutilise l'UI de `group-chat-window.tsx` adaptée : nouvelle table + nouveau bucket).
- Notifications : la cloche existante affiche déjà tout type ; on ajoute le type `internal_message` avec lien.

---

## 4. Sécurité & vérifications

- Tests manuels via Playwright/preview après migration :
  - Compte Chanez (BPF) : voit uniquement dossiers BPF, clients BPF, aucun bouton supprimer, URL directe vers un dossier NDA = "Accès refusé".
  - Admin : accès global inchangé.
  - Messagerie interne : Chanez peut créer une conversation avec un autre BPF ou admin/direction, pas avec un consultant NDA.
- Re-scan sécurité après migration.

---

## Détails techniques (annexe)

Ordre d'exécution :
1. Migration DB (helpers + RLS + tables internes + storage bucket via tool). *Une seule migration groupée si possible.*
2. Suppression du serverFn `deleteClient`, ajout `archiveClient`/`unarchiveClient`.
3. Ajout des serverFn messagerie interne.
4. Nouvelles routes + composants UI + guard `beforeLoad`.
5. Retrait UI du bouton supprimer, remplacé par archiver.
6. Vérif preview + logs console.

Fichiers principaux touchés :
- `src/lib/admin-clients.functions.ts`, `src/lib/internal-messages.functions.ts` (nouveau)
- `src/routes/_authenticated/admin.clients.$id.tsx`, `admin.clients.index.tsx`, `admin.messages.*`
- `src/routes/_authenticated/admin.internal-messages.index.tsx` + `admin.internal-messages.$id.tsx` (nouveaux)
- `src/routes/_authenticated/dossiers.$id.tsx` (guard)
- `src/components/app-shell.tsx`
- `src/components/internal-chat-window.tsx` (nouveau, fork de `group-chat-window.tsx`)

Points de vigilance :
- Les triggers existants (`notify_new_message`, `enforce_message_client_update`, etc.) ne doivent pas s'appliquer aux messages internes → tables séparées, pas de partage.
- `pole_members` reste la source de vérité ; s'assurer que Chanez y figure bien (déjà vérifié précédemment).
- Le bucket `internal-chat-files` doit rester privé — signed URLs uniquement.
- Les policies `TO authenticated` doivent utiliser `has_role` / `is_agency_member` pour éviter la récursion.

Une fois validé, j'exécute la migration DB en premier (elle demande votre approbation), puis j'enchaîne le code.
