# 007: Group, internal and external chats must show recent messages beyond 1,000

| Field | Value |
|---|---|
| Written against | `origin/main` @ `406bd10` (2026-11-17) |
| Priority | P1, user-facing data loss (new messages invisible) |
| Effort | S |
| Depends on | none |
| Status | TODO |

Branch: `git switch -c improve/007-messageries origin/main`. One commit per file is fine.

## Why

Supabase (PostgREST) returns **at most 1,000 rows** per request. Three chats load their whole
history in **ascending** order with no limit. Once a conversation passes 1,000 messages, the
server cuts off the **newest** rows. The latest messages never appear, not even in real time,
because the realtime handler only invalidates the query and the refetch is cut again.

## The pattern to copy (already correct in the repo)

`src/components/chat-window.tsx` lines ~116-131:

```ts
const { data, error, count } = await supabase
  .from("messages")
  .select(MESSAGE_COLS, { count: "exact" })
  .eq("client_id", clientId)
  .order("created_at", { ascending: false })
  .limit(limit);
if (error) throw error;
return { rows: (data ?? []).slice().reverse(), total: count ?? 0 };
```

## Changes (only these 3 files)

1. `src/components/group-chat-window.tsx` (query at ~49-60, table `group_messages`)
2. `src/routes/_authenticated/admin.internal-messages.$id.tsx` (query at ~113-123, table `internal_messages`; today it **ignores `error`**)
3. `src/components/dossier-external-chat.tsx` (query at ~71-82, table `internal_messages`; ignores `error`)

In each one:
- Order by `created_at` **descending**, apply `.limit(500)`, then `.reverse()` the array so
  the UI keeps chronological order. Keep the same `queryKey` and the same returned array shape,
  so every consumer works unchanged.
- Destructure `error` and `throw error` when it is set.
- Do NOT add a "load older" button. That is out of scope (500 recent messages is plenty).

In `group-chat-window.tsx`, the read-receipt query (~66-78, `group_message_reads`) must only
read receipts for the loaded messages: add `.in("message_id", ids)`, where `ids` are the loaded
message ids, in chunks of 100 (see the chunk loop in `src/routes/_authenticated/admin.messages.index.tsx` ~137-145).
Enable it only when `ids.length > 0`, and add the ids to its query key.

## Out of scope

`chat-window.tsx` (already correct), realtime subscriptions, styling.

## Done criteria

- `npx tsc --noEmit 2>&1 | grep -E "group-chat-window|internal-messages\.\$id|dossier-external-chat"` prints nothing.
- `grep -n "ascending: true" <the 3 files>` no longer matches the message queries.
- Manual: open a group chat. Messages are still in chronological order and a newly sent message appears.

## Escape hatch

If a consumer relies on the full history (for example search across all messages), STOP and report
it instead of changing that consumer.
