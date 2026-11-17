# 011: Faster admin pages: fewer duplicate requests, and a messaging list without a full scan

| Field | Value |
|---|---|
| Written against | `origin/main` @ `9a61503` (2026-11-17) |
| Priority | P1: slowness felt by the team |
| Effort | M |
| Status | TODO |

## Measured on izisuivis.com (admin account, 17/11/2026)

- `/admin` (dashboard) sends **89 data requests** in the first 8 s, each taking 300-800 ms. Many are duplicates:
  - `/auth/v1/user` 7×
  - `profiles` 12×
  - `agency_tasks` 12×
  - `dossiers` 10×
  - `notifications` 9×
  - `user_roles` 6×
  - `messages` 6× (up to 817 ms)
- `/admin/messages` takes 3.7 s, with `messages` 4× up to 1.1 s each.
- `/dossiers` takes 0.8 s, which is fine.

## Part A: remove duplicate requests (code only)

1. **`/auth/v1/user` (7×).**
   - Find the client-side calls to `supabase.auth.getUser()` (grep in `src/`, excluding `*.server.ts` and server middleware).
   - In components and hooks, use the user from `useAuth()` (`src/hooks/use-auth.tsx`), or `supabase.auth.getSession()`, which reads from memory, instead of a fresh network call.
   - Leave `getUser()` only where a server-side identity check is needed (server functions and middleware).
2. **`profiles`, `user_roles`, `agency_tasks`, `notifications`, `dossiers` loaded several times on `/admin`.**
   - Find the components mounted on that page and in the app shell (`src/components/app-shell.tsx`, `notifications-bell.tsx`, `notifications-realtime.tsx`, `my-tasks-button.tsx`, `use-my-tasks`, `use-role`, the `admin.index.tsx` dashboard panels).
   - When two components request **the same data**, make them share **one** TanStack Query `queryKey`, through a shared hook if needed, so that React Query fetches once.
   - When the requests differ only by columns, select the union once.
   - Keep every behaviour and every displayed value identical.
   - Do NOT add caching that hides fresh data: keep the existing `staleTime` and realtime invalidations.
3. **Realtime.** The perf audit found:
   - two subscriptions to `notifications` INSERT for the same user (`notifications-bell.tsx` and `notifications-realtime.tsx`);
   - `my-tasks-button.tsx` subscribed to every `agency_tasks` change with no filter.

   Fixes:
   - Keep the browser notification shown by the bell, but make sure one INSERT causes a single `invalidateQueries`.
   - Add a server-side filter on the tasks subscription if the schema allows it, for example the current user's assignments. If not, leave it as is.

## Part B: admin messaging list without scanning every message

- `src/routes/_authenticated/admin.messages.index.tsx`:
  - `fetchAllMessageHeaders()` reads up to 50,000 message headers in pages of 1,000 (`CHUNK`, `MAX_SCAN`), only to work out the last message and the unread count per client;
  - every incoming message invalidates the whole list.
- Write a SQL function `public.admin_message_threads()`: `security definer`, `set search_path = public`, staff only (`if not public.is_staff(auth.uid()) then raise exception`).
  - It returns one row per `client_id`: last message date, last message id, last sender / `from_agence`, unread count (same unread rule as the current code), total count.
  - Exclude `deleted_at is not null`, as the current code does.
  - Use `distinct on` or `group by`.
  - Write it to **`plans/011-admin-message-threads.sql`**, NOT in `supabase/migrations`. The owner (Claude, in a separate step) applies it. It must contain only `create or replace function` + `revoke`/`grant execute ... to authenticated`. No data change.
- Change `admin.messages.index.tsx` to call `supabase.rpc("admin_message_threads")` instead of the scan.
  - Keep the previews fetch (by message ids in chunks) and the same UI data shape.
  - Debounce the realtime invalidation: at most one refetch per 2 s.

## Rules

- Branch `improve/perf-chargement` (already checked out). Commit per part. French messages ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never push. Never run SQL or connect to a database. Never read `.env`.
- Verify with `node node_modules/typescript/bin/tsc --noEmit` (must stay 0 errors) and `npx -y bun run test` (7 tests pass).
- If removing a duplicate would change what a user sees, skip that one and report it.

## Done criteria

- tsc 0, tests pass.
- `grep -rn "auth.getUser()" src --include=*.tsx` only matches places that need it, justified in the report.
- The report lists, per table, the number of `/admin` requests before and after, as the executor estimates them from the code.
