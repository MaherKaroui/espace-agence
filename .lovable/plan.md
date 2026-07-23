# Évolution IZISuivis — Rôles Auditeur & Certificateur + Module Qualiopi

Vu l'ampleur, je propose de découper en 4 lots livrés dans l'ordre, sans casser l'existant. Je te confirme le lot A dans cette réponse et j'enchaîne B → C → D si tu me dis "go tout".

---

## Lot A — Fondation : rôles + affectations + référentiel RNQ

**Base de données (migration unique)**
- Enum `app_role` : ajouter `auditeur`, `certificateur`.
- Table `dossier_assignments(dossier_id, user_id, role, assigned_by, assigned_at, active)` — un auditeur/certif peut être affecté à N dossiers.
- Table `qualiopi_criteria` (7 critères) + `qualiopi_indicators` (32 indicateurs, num + libellé court + critère). Seed complet du RNQ dans la migration.
- Helpers SQL :
  - `is_assigned_to_dossier(_user, _dossier)` SECURITY DEFINER
  - `user_visible_dossiers(_user)` (retourne les dossiers visibles selon rôle : admin/direction=all, manager=poles, client=owned, auditeur/certif=via assignments)
- RLS : étendre les policies `dossiers`, `messages`, `documents`, `agency_tasks` pour inclure `is_assigned_to_dossier(auth.uid(), dossier_id)`.
- GRANTS conformes.

**UI Admin**
- Page `/admin/equipe` : autoriser l'assignation des rôles auditeur/certificateur.
- Fiche dossier : nouveau bloc "Intervenants externes" pour affecter/révoquer un auditeur ou un certificateur (staff uniquement).

---

## Lot B — Espaces Auditeur & Certificateur + Chat sécurisé

**Nouvelles routes** (layout `_authenticated`, gated par rôle) :
- `/auditeur` — liste des dossiers affectés
- `/auditeur/dossier/$id` — détail + chat + panneau Qualiopi
- `/certificateur` — même principe
- `/certificateur/dossier/$id` — détail avec historique complet lecture seule sur messages clients + chat propre

**Chat** : réutiliser `conversations` + `messages` existantes.
- Ajouter colonne `conversations.kind` : `client` (existant, défaut) | `auditeur` | `certificateur`.
- Une conversation `auditeur`/`certificateur` est liée à un `dossier_id` ; membres = staff pôle + user externe affecté. Cloisonné du chat client d'origine.
- Réutiliser composants `chat-thread`, `rich-message-content`, avatars, ephemeral mode.
- App-shell : afficher menu "Auditeur" / "Certificateur" selon le rôle exclusif ; masquer Pilotage/Organisation.

---

## Lot C — Demandes de pièces Qualiopi

**BDD**
- `qualiopi_document_requests(id, dossier_id, requested_by, role, message, priority, due_date, status, created_at, updated_at)` — statuts : `en_attente`, `deposee`, `validee`, `refusee`, avec `refusal_reason` obligatoire si refusée (trigger).
- `qualiopi_document_request_indicators(request_id, indicator_id)` — N-N.
- `qualiopi_document_submissions(id, request_id, submitted_by, file_path, file_name, file_size, sha256, mime, antivirus_status default 'pending', version, created_at)` — version auto-incrémentée par request.
- Trigger notifications sur INSERT/UPDATE de request et submission → réutilise le hub `notifications` + push existant + email (nouveau template `qualiopi_*`).
- RLS : lecture/écriture limitée aux acteurs affectés au dossier.

**UI**
- Panneau latéral "Demandes Qualiopi" dans la fiche dossier (visible staff + auditeur/certif affecté + client OF).
- Vue par critère → indicateurs → demandes/documents ; filtres statut / échéance / indicateur.
- Formulaire nouvelle demande : sélection indicateurs (chips), message, échéance, priorité.
- Détail demande : versions, historique statuts, boutons Valider / Refuser (motif obligatoire), Déposer nouvelle version (côté staff/client).
- Badges : En attente / Déposée / Validée / Refusée / En retard (calculé à partir de `due_date`).

---

## Lot D — Upload gros fichiers + Audit trail + Notifs

**Storage**
- Bucket privé `qualiopi-documents` (créé via `supabase--storage_create_bucket`).
- Upload direct Supabase Storage via `upload({upsert:false})` avec `onUploadProgress` (barre de progression). Limite UI 500 Mo, formats whitelistés (PDF/DOCX/XLSX/JPG/PNG/ZIP/MP4). Note UI : la reprise multipart réelle dépend du backend Storage ; on branche `resumable` si dispo, sinon fallback classique avec message clair.
- Hash sha256 calculé côté client avant upload (Web Crypto).
- Téléchargement via `createSignedUrl` (5 min), bloqué si `antivirus_status = 'infected'`.
- Colonne `antivirus_status` prête + hook `scan_document` (stub `pending → clean` par défaut, extensible).

**Audit trail**
- Table `audit_trail(id, actor_id, actor_role, dossier_id, conversation_id, indicator_id, entity_type, entity_id, action, old_value, new_value, ip, user_agent, created_at)` — rétention 3 ans (colonne `retention_until`).
- Triggers sur `qualiopi_document_requests`, `qualiopi_document_submissions`, `messages` (kind ≠ client), `dossier_assignments`.
- Vue admin `/admin/audit-qualiopi` avec filtres dossier / acteur / indicateur / période.

**Notifications**
- Étendre `notification_type` : `qualiopi_request_created`, `qualiopi_submission`, `qualiopi_validated`, `qualiopi_refused`, `qualiopi_due_soon`, `qualiopi_overdue`.
- Fan-out réutilise `team_notification_recipients_for_pole` + destinataires externes affectés au dossier.
- Cron `pg_cron` quotidien : détection échéances J-2 et retards → notifs + emails.
- Templates emails dans `src/lib/email-templates/qualiopi-*.ts`.

---

## Matrice de droits appliquée (rappel)

| Rôle | Voir dossiers | Chat client | Chat auditeur | Chat certif | Demandes Qualiopi |
|---|---|---|---|---|---|
| admin / direction | tous | oui | oui | oui | tout |
| manager / consultant | pôles | oui | oui (si pôle) | oui (si pôle) | tout du pôle |
| client / OF | siens | oui | non | non | ses demandes (dépose) |
| auditeur | affectés | non | oui | non | ses demandes |
| certificateur | affectés | lecture historique | non | oui | ses demandes + suivi |

---

## Détails techniques

- Server fns dans `src/lib/qualiopi/*.functions.ts` (list/create/update requests, submissions, assignments).
- `requireSupabaseAuth` + vérif rôle via `has_role` + `is_assigned_to_dossier` côté handler.
- Route uploads volumineux : server route `src/routes/api/qualiopi/upload.ts` pour initier/valider (hash + sha256 sur le serveur pour audit) ; l'upload binaire va directement à Supabase Storage (évite les 10 Mo de la Worker Cloudflare).
- Aucune modification des routes/tables existantes de messagerie client — seul l'ajout du champ `kind` (défaut `client`) est neutre.
- Seed indicateurs Qualiopi complet (32 lignes) dans la migration du Lot A.

---

## Vérifications après chaque lot
- Lot A : linter Supabase clean, RLS testée par rôle en `read_query`.
- Lot B : login auditeur factice → ne voit qu'un dossier ; chat fonctionne.
- Lot C : cycle en_attente → déposée → validée + refus avec motif obligatoire.
- Lot D : upload 100 Mo, signed URL, entrée audit_trail, email + push reçus.

---

**Confirme-moi "go A" (ou "go tout") et je démarre par la migration du Lot A.**
