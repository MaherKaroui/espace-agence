# 003: Send team and group emails from the server (fix blocked emails and the address leak)

| Field | Value |
|---|---|
| Written against | `origin/main` @ `c620189` (2026-10-26) |
| Priority | P1, bug + security |
| Effort | M |
| Depends on | none (002 recommended first, for `archived_at`) |
| Status | TODO |

## Why this matters

**Visible bug:** staff **never** get the emails "message client", "document déposé" or "nouveau
dossier" when the actor is a client.

The flow is:
- The client's browser calls `notifyTeamClientMessage` (`src/components/chat-window.tsx:338`),
  `notifyTeamDocumentDepose` (`src/components/required-documents.tsx:153`) and
  `notifyTeamNewDossier` (`src/components/create-dossier-dialog.tsx:112`,
  `src/routes/_authenticated/dossiers.index.tsx:140`).
- These functions (`src/lib/email/notify-team.ts`) fetch the staff email list, then call
  `notifyEmail` → `sendTransactionalEmail` → server function `sendAppEmailFn` once per address.
- `sendAppEmailFn` (`src/lib/email/send.functions.ts:33-39`) refuses a non-staff caller who sends
  to an address other than their own, unless the template has a fixed recipient:
  ```ts
  if (!callerIsStaff) {
    ...
    if (!fixed && !selfRecipient) {
      console.warn('[email] blocked unauthorized recipient', { templateName: data.templateName })
      return { success: false, reason: 'forbidden' as const }
  ```
- `team-*` templates have no `to` (`send.server.ts:84-85`: `fixed = Boolean(adminOverride || template?.to)`).
  So everything is refused, and the error is swallowed (`catch { /* silencieux */ }`).

Client-side group messages hit the same problem (`notifyGroupNewMessage("client", …)` in
`src/components/group-chat-window.tsx:149`).

**Security:** to work, this design returns the staff email list to the browser:
- `getTeamRecipientsForDossier` (`src/lib/team-notify.functions.ts:14-81`) returns `emails` to the
  dossier's client, despite the comment at line 12.
- `getTeamRecipientsForClient` (`team-notify.functions.ts:88-136`) has **no authorization check**:
  any logged-in user who passes any UUID gets every admin and direction email back.
- `getGroupRecipients` (`src/lib/group-notify.functions.ts:47-48`) accepts arbitrary `userIds` and
  returns their emails (up to 200).
- In addition, `team-notify` does not filter archived staff, unlike `group-notify` (line 67).

## Target state

- Resolving recipients **and** sending happen in **one** server function per use case. The browser
  only sends identifiers. The server returns `{ ok: true, sent: <number> }` and **never an email
  address**.
- Authorization is checked server-side:
  - dossier events: the caller can see the dossier (RLS read with the user client);
  - client message: the caller is the client (`clientId === userId`) or staff;
  - group events: the caller is a member of the conversation, and `userIds` is filtered down to the
    conversation's actual members.
- Archived recipients are excluded.
- Existing call sites **do not change**: the exported signatures in `notify-team.ts` and
  `notify-group.ts` stay the same.

## Conventions and exemplar

Exemplar of a server function that sends through `sendAppEmail`: `src/lib/broadcast.functions.ts:19-60`:

```ts
export const broadcastToClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ ... }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    ...
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendAppEmail } = await import("./email/send.server");
    const { APP_URL } = await import("./app-url");
```

- `sendAppEmail(args)` (`src/lib/email/send.server.ts:89`) never throws. It already handles the
  template enabled/disabled check and logging to `email_send_log`. Don't re-implement those.
- Each email's `templateData` must include `appUrl: APP_URL`, as `notifyEmail` did
  (`src/lib/email/notify.ts:41`).
- Keep the existing idempotency keys **exactly as they are**, including the 10-minute bucket: see
  `notify-team.ts` and `notify-group.ts`.

---

## Steps

Branch: `git switch -c improve/003-emails-serveur origin/main`.

### Step 1: rewrite `src/lib/team-notify.functions.ts`

Replace both exports (`getTeamRecipientsForDossier`, `getTeamRecipientsForClient`) with **one** export:

```ts
export const notifyTeamFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.discriminatedUnion("event", [
      z.object({ event: z.literal("nouveau_dossier"), dossierId: z.string().uuid() }),
      z.object({ event: z.literal("document_depose"), dossierId: z.string().uuid(), documentNom: z.string().max(300).optional() }),
      z.object({ event: z.literal("client_message"), clientId: z.string().uuid(), extrait: z.string().max(500).optional() }),
    ]).parse(data),
  )
  .handler(async ({ data, context }) => { ... return { ok: true, sent }; });
```

Handler logic. Reuse the existing queries in the file, moving them; don't invent new ones.
1. **Dossier events:** read the dossier with the **user** client (`context.supabase`). This is the
   current code at lines 21-26. If it is not found, return `{ ok: true, sent: 0 }`. Recipients are
   pole members plus admin/direction (current code, lines 37-61), minus the client.
2. **`client_message`:** if `data.clientId !== userId`, check that the caller is staff: a
   `user_roles` read on `userId` with role in `['admin','direction','manager','consultant']`. If not,
   `throw new Error("Non autorisé")`. Recipients come from the current code at lines 101-125, minus
   the client and the caller.
3. Load profiles with `.select("email, archived_at").in("id", ids)`, keep
   `!archived_at && email`, and dedupe.
4. Build `templateData` server-side. Labels: move the `CATEGORIE_LABELS` and `STATUT_LABELS`
   constants from `src/lib/email/notify-team.ts:4-11` into this file. Per event, the template and
   data are **exactly** those of the current `notify-team.ts` functions:
   - `team-nouveau-dossier`, key `team-new-dossier-${dossierId}-${email}-${bucket}`
   - `team-document-depose`, key `team-doc-${dossierId}-${email}-${bucket}`
   - `team-client-message`, key `team-msg-${clientId}-${email}-${bucket}`, `extrait` truncated to 140
   - and add `appUrl: APP_URL` to every one.
5. Send with `await Promise.allSettled(emails.map(e => sendAppEmail({...})))`. `sent` is the number
   of `success === true` results. Return `{ ok: true, sent }`, **without** emails.

### Step 2: rewrite `src/lib/group-notify.functions.ts`

Replace `getGroupRecipients` with `notifyGroupFn`:

```ts
z.discriminatedUnion("event", [
  z.object({ event: z.literal("new_message"), kind: z.enum(["client","internal"]), conversationId: z.string().uuid(), extrait: z.string().max(500).optional() }),
  z.object({ event: z.literal("members_added"), kind: z.enum(["client","internal"]), conversationId: z.string().uuid(), userIds: z.array(z.string().uuid()).max(200), groupTitreFallback: z.string().max(200).optional() }),
])
```

- Keep the existing membership check (lines 29-36). If the caller is not a member, return
  `{ ok: true, sent: 0 }`.
- **`members_added`:** filter `userIds` to those that are **actually** members of the conversation
  (`supabaseAdmin.from(memberTable).select("user_id").eq("conversation_id", …).in("user_id", data.userIds)`).
  This fixes the address leak for arbitrary IDs.
- Keep the archived filter (line 67) and the `senderName` computation (lines 72-80).
- Templates, idempotency keys and data are the same as in today's `src/lib/email/notify-group.ts`
  (`group-invitation` with key `group-invite-${conversationId}-${email}`; `group-nouveau-message`
  with key `group-msg-${conversationId}-${email}-${bucket}`), plus `appUrl: APP_URL`. Move the
  `linkFor` function from `notify-group.ts:6-10` into this file.
- Return `{ ok: true, sent }`.

### Step 3: thin the browser wrappers (signatures unchanged)

- `src/lib/email/notify-team.ts`: keep the 3 exports with **the same parameters**. Each body becomes:
  ```ts
  try { await notifyTeamFn({ data: { event: "nouveau_dossier", dossierId } }) } catch (e) { console.warn("[notify-team]", e) }
  ```
  Remove the now-unused imports and constants. Replace the silent `catch {}` with `console.warn` so
  failures stay visible in the console.
- `src/lib/email/notify-group.ts`: same with `notifyGroupFn`, keeping
  `notifyGroupMembersAdded(kind, conversationId, userIds, groupTitreFallback?)` and
  `notifyGroupNewMessage(kind, conversationId, extrait?)`. Keep `if (!userIds.length) return`.

### Step 4: check that nothing else uses the removed exports

`grep -rn "getTeamRecipientsForDossier\|getTeamRecipientsForClient\|getGroupRecipients" src` must
return **nothing**. If something does, STOP.

### Out of scope: do not touch

- `src/lib/email/send.functions.ts` and its guard: it stays as it is. It still protects direct calls
  from the browser. (Plan "templateData validation", n° 7 of the audit, will tighten it later.)
- The 5 call sites (`chat-window.tsx`, `required-documents.tsx`, `create-dossier-dialog.tsx`,
  `dossiers.index.tsx`, the group pages): **no changes**.
- DB triggers that create in-app notifications (bell + push): not affected.

## Verification

| Command | Expected |
|---|---|
| `bun install --frozen-lockfile && bun run build` | exits 0 |
| `bunx tsc --noEmit 2>&1 \| grep -E "team-notify\|group-notify\|notify-team\|notify-group"` | no output |
| `bun run lint 2>&1 \| grep -E "team-notify\|group-notify\|notify-team\|notify-group"` | no errors |
| `grep -rn "getTeamRecipients\|getGroupRecipients" src` | no output |
| `grep -n "emails" src/lib/team-notify.functions.ts src/lib/group-notify.functions.ts \| grep return` | no output (no email list in any `return`) |
| `grep -c "appUrl: APP_URL" src/lib/team-notify.functions.ts src/lib/group-notify.functions.ts` | ≥3 and ≥2 |

Owner, after deploying (with a test client account and a staff account):
1. As the client, send a message in the chat → within about a minute, the staff email
   "team-client-message" arrives.
2. As the client, upload a required document → "team-document-depose" arrives.
3. In the SQL editor:
   `SELECT template_name, status, created_at FROM email_send_log WHERE template_name LIKE 'team-%' ORDER BY created_at DESC LIMIT 10;`
   shows `sent` rows. Today there are presumably none for client-triggered actions.
4. In DevTools → Network, the response from the `notifyTeamFn` server function contains no `@`.

## STOP conditions

- Templates in `src/lib/email-templates/team-*.tsx` expect different `templateData` from what
  `notify-team.ts` sends today → STOP. Don't change the templates without checking.
- `z.discriminatedUnion` is not available in the installed zod version (`zod ^4` is installed and
  supports it) → use `z.union` and report it.
- Sending to more than about 30 recipients times out the server function → report it. Don't add a
  queue on your own initiative.

## Maintenance notes

- Rule from now on: **never** resolve recipient addresses in the browser. Any new staff notification
  goes through `notifyTeamFn`/`notifyGroupFn`, or through a DB trigger.
- The labels now live in `team-notify.functions.ts`. They duplicate `src/lib/labels.ts` and
  `src/lib/email/notify.ts`; consolidating them is a future refactor, out of scope here.
