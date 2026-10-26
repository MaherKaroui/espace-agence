# 005: Batch of small bugs: read receipts, document replacement, RDV time

| Field | Value |
|---|---|
| Written against | `origin/main` @ `c620189` (2026-10-26) |
| Priority | P1, user-facing bugs (one with data loss) |
| Effort | S (3 independent fixes, about 10 lines each) |
| Depends on | none |
| Status | TODO |

Three **independent** fixes. Make **one commit per fix**, so any one can be reverted on its own.
Branch: `git switch -c improve/005-petits-bugs origin/main`.

---

## Fix A: a staff member opening a conversation marks colleagues' messages as "Vu"

**File:** `src/components/chat-window.tsx`, lines 276-288 (current code):

```tsx
  // Accusés de lecture — une seule fois par message, sans relancer de boucle.
  useEffect(() => {
    if (!user || isSearching) return;
    const unread = messages.filter(
      (m) => !m.read_at && m.sender_id !== user.id && !markedReadRef.current.has(m.id),
    );
    if (unread.length === 0) return;
    for (const m of unread) markedReadRef.current.add(m.id);
    supabase
      .from("messages")
      .update({ read_at: new Date().toISOString(), read_by: user.id } as any)
      .in("id", unread.map((m) => m.id))
      .then();
  }, [messages, user, isSearching]);
```

**Problem:** for a staff viewer, messages from **other** staff members (`from_agence = true`) pass the
filter. They get marked read, and the UI then shows "✓✓ Vu" (lines ~790 and ~1002), even though the
client has not read them.

**Fix:** a message is "readable" by the viewer only if it comes from **the other side**. The
component already has `isStaff` (line 78, `const { isAdmin, isStaff } = useRole();`), and
`from_agence` is in the select (line 37).

- In the filter, add the condition `m.from_agence !== isStaff`. A staff viewer only marks client
  messages; a client only marks agency messages.
- Add `isStaff` to the dependency array: `[messages, user, isSearching, isStaff]`.

**Edge case (required):** `useRole()` returns `isStaff = false` while it is loading. A staff member
would then briefly mark colleagues' messages as read. `src/hooks/use-role.ts` exposes `loading`
(`loading: authLoading || (!!user && q.isLoading)`). Change line 78 to
`const { isAdmin, isStaff, loading: roleLoading } = useRole();`, add
`if (roleLoading) return;` at the top of the effect, and add `roleLoading` to the dependencies.

**Do not** touch `group-chat-window.tsx`. Group read receipts are per user (`group_message_reads`),
so the problem does not exist there.

---

## Fix B: replacing a required document deletes the old file before the upload

**File:** `src/components/required-documents.tsx`, `upload` mutation, lines 118-155. Current code
(lines 121-143):

```tsx
      if (doc) {
        if (doc.storage_path) {
          await supabase.storage.from("documents").remove([doc.storage_path]);
        }
        await supabase.from("documents").delete().eq("id", doc.id);
      }
      const ext = ...
      const path = `${dossierId}/${crypto.randomUUID()}-${renamed}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { ... });
      if (upErr) throw upErr;
      const { data: inserted, error } = await supabase.from("documents").insert({ ... }).select("id").single();
      if (error) throw error;
```

**Problem:** if the upload fails (network, size, MIME type), the old file and its row are already
deleted. The client loses a valid document.

**Fix:** reorder the operations into **upload → insert → then delete the old one**:
1. Move the `if (doc) { … }` block **after** `if (error) throw error;` (after the insert).
2. If the insert fails after a successful upload, remove the newly uploaded file
   (`supabase.storage.from("documents").remove([path])`) before the `throw`, so no orphan file is
   left behind.
3. In the old-document deletion block (now at the end), check the errors from `remove` and `delete`.
   On error, `console.warn("[required-documents] ancien document non supprimé", …)` and **do not**
   throw: the new document is already saved, so the user has succeeded.
4. Capture `const previous = doc;` at the start of the mutation, and use `previous` in the final
   block. `doc` could change after the invalidation.

Keep everything else unchanged: renaming, `from_agence: isAdmin`, `detected_type`, Drive filing and
team notification in `onSuccess`/after the insert.

---

## Fix C: RDV reminder email times are in UTC

**File:** `src/routes/api/public/hooks/reminders.ts`, lines 25-31:

```ts
function frDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}
```

**Problem:** the server runs in UTC, so a 10:00 appointment (Paris) is shown as "08:00" in summer
and "09:00" in winter. The in-app reminder in SQL is correct (`AT TIME ZONE 'Europe/Paris'`).

**Fix:** add `timeZone: 'Europe/Paris'` to the options object. This is exactly the pattern used in
`src/lib/daily-activity-report.server.ts:552-556`:
```ts
  return new Date(iso).toLocaleTimeString("fr-FR", {
    timeZone: "Europe/Paris",
```
The file uses single quotes with no `;`. Keep that style.

Nothing else in this file is in scope. The other reminder bugs found in the audit (dedup, unbounded
`.in()`) are separate topics.

---

## Verification (after all 3 commits)

| Command | Expected |
|---|---|
| `bun install --frozen-lockfile && bun run build` | exits 0 |
| `bunx tsc --noEmit 2>&1 \| grep -E "chat-window\|required-documents\|reminders"` | no new errors compared to the baseline taken before changes |
| `bun run lint 2>&1 \| grep -E "chat-window\|required-documents\|reminders"` | no new errors |
| `grep -n "from_agence !== isStaff" src/components/chat-window.tsx` | 1 match |
| `grep -n "timeZone: 'Europe/Paris'" src/routes/api/public/hooks/reminders.ts` | 1 match |
| `git log --oneline origin/main..HEAD` | 3 commits |
| In `required-documents.tsx`, the line `.from("documents").delete()` appears **after** `.insert(` | check with `grep -n 'insert(\|delete()' src/components/required-documents.tsx` (the delete line number must be > the insert line number) |

Quick check of C: `node -e "console.log(new Date('2026-07-01T08:00:00Z').toLocaleString('fr-FR',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}))"`
→ contains `10:00`.

Manual check (owner, preview):
- A: as consultant A, write to a client. As consultant B, open the thread. As A, the message must
  **not** show "Vu". As the client, open the thread → A sees "Vu".
- B: replace an existing required document while offline (DevTools → Offline) → error toast, and the
  old document is **still** present after a reload.

## STOP conditions

- `from_agence` is missing from some messages (null) → `null !== true` is `true`, so a staff viewer
  would mark them read. If `SELECT count(*) FROM messages WHERE from_agence IS NULL` > 0, report it
  before deploying.
- The structure of the `upload` mutation differs from the excerpt (the file has changed) → STOP.

## Maintenance notes

- Read receipts: the rule is "only the other side marks read". Keep it if staff↔staff threads appear
  in `messages`.
- Every new server-side date format: always pass `timeZone: 'Europe/Paris'`.
