# 010: Client reminders, notifications and asset weight: small targeted fixes

| Field | Value |
|---|---|
| Written against | `origin/main` @ `406bd10` (2026-11-17) |
| Priority | P2 |
| Effort | S (3 independent fixes; one commit each) |
| Depends on | none |
| Status | TODO |

Branch: `git switch -c improve/010-relances-allegements origin/main`.

## Fix 1: no reminders for validated or archived dossiers

File: `src/routes/api/public/hooks/reminders.ts`.

- **"Dossiers inactifs" query (~159-165)**
  - It excludes only `statut in (termine, refuse)`.
  - Add `valide`: `.not('statut', 'in', '(termine,refuse,valide)')`.
  - Add `.is('archived_at', null)`.
- **"Missing documents" query (~104-111)**
  - It selects `dossiers.statut` but never filters on it.
  - Apply the same exclusion: skip dossiers whose statut is `termine`, `refuse` or `valide`, or whose `archived_at` is set.
  - Do it in the query if the join allows it, otherwise in JS right after.
- Verify the enum values in `src/integrations/supabase/types.ts` (`dossier_statut`) before writing them.

## Fix 2: one notification subscription, not two

- `src/components/notifications-bell.tsx` (~66-90) and `src/components/notifications-realtime.tsx` (~37-73)
  both subscribe to INSERT on `notifications` for the same user. Each one invalidates `["notifications", uid]`.
- Remove only the **invalidation** in `notifications-bell.tsx` and keep the one in `notifications-realtime.tsx`.
  - If the bell's channel does nothing but invalidate, remove that subscription entirely.
  - If it also plays a sound or shows a toast that `notifications-realtime` does not, keep that behaviour and STOP: report instead.

## Fix 3: logo weight

- `src/assets/logo-izisuivis-icon.png` is about 866 KB and is displayed at 36 px on every page (`src/components/logo.tsx`).
- Generate a resized copy at 144×144 px: `src/assets/logo-izisuivis-icon-144.png`.
  - Python Pillow: `Image.open(src).convert("RGBA").resize((144,144), Image.LANCZOS).save(dst, optimize=True)`.
  - Run it from a scratch dir outside the repo.
- Point `logo.tsx` at the new file. Keep the original file, because other places (favicon, mobile icons) may use it.

## Done criteria

- `npx tsc --noEmit 2>&1 | grep -E "reminders|notifications-bell|logo"` prints nothing.
- The new PNG is under 40 KB: `ls -l src/assets/logo-izisuivis-icon-144.png`.
