# 008: Dossier lists: correct cache per role, and `.in()` lookups that neither truncate nor fail

| Field | Value |
|---|---|
| Written against | `origin/main` @ `406bd10` (2026-11-17) |
| Priority | P1: wrong or empty lists for staff, and wrong statistics |
| Effort | M |
| Depends on | none |
| Status | TODO |

Branch: `git switch -c improve/008-listes-dossiers origin/main`.

## Bug A: role race and shared cache key

- `src/routes/_authenticated/dossiers.index.tsx` ~65-74 and `src/routes/_authenticated/dashboard.tsx` ~75-84
  both use `queryKey: ["dossiers-mine", user?.id]`.
  - `dossiers.index` filters `client_id = user` unless `asStaff`.
  - `dashboard` filters unless `isAdmin`.
- Roles come from `useRole()` (`src/hooks/use-role.ts`). It returns `false` for every flag while
  it is loading (`loading` is true).
- The query is `enabled: !!user`, so it runs before the roles are known.
  - Result: a staff member who opens `/dossiers` directly sees only the dossiers where they are the client (usually none).
  - The two pages also overwrite each other's cache.

Fix in both files:
- `enabled: !!user && !roleLoading`, where `roleLoading` is the `loading` returned by `useRole()`.
- Put the role in the key:
  - `queryKey: ["dossiers-mine", user?.id, asStaff]` in `dossiers.index`
  - `["dossiers-mine", user?.id, isAdmin]` in `dashboard`
- Invalidation calls elsewhere use the prefix `["dossiers-mine"]` and still match. Do not change them.

## Bug B: unbounded `.in("dossier_id", allIds)`

Each of these sends every dossier id in one GET URL. The URL can exceed its length limit (the request then fails), and the response is capped at 1,000 rows.
- `dossiers.index.tsx` ~225-249: `documents` and `taches`
- `dashboard.tsx` ~88-117: `documents` and `taches`
- `src/routes/_authenticated/admin.dossiers.tsx` ~212-254: `documents` and `dossier_assignments`

Create `src/lib/fetch-in-chunks.ts`:

```ts
/** Runs `build(chunk)` for chunks of `ids` (100 at a time) and concatenates the rows; pages each chunk past 1,000 rows. */
export async function fetchInChunks<T>(ids: string[], build: (chunk: string[]) => any, size = 100): Promise<T[]>
```

- For each chunk: loop `.range(from, from + 999)` until a page returns fewer than 1,000 rows.
- `throw` on `error`.
- Run the chunks in parallel, with at most 4 in flight.
- `build(chunk)` must return a fresh query builder each time, for example `(c) => supabase.from("documents").select("...").in("dossier_id", c)`. The helper adds the range.

Replace the 6 queries above with this helper. Keep the selected columns, the query keys and the result shapes exactly as they are.

## Out of scope

The pagination of the dossiers list itself, and `select("*")` column trimming. Leave both alone.

## Done criteria

- `npx tsc --noEmit 2>&1 | grep -E "fetch-in-chunks|dossiers\.index|dashboard\.tsx|admin\.dossiers\.tsx"` prints nothing.
- `grep -n '\.in("dossier_id", dossierIds)\|\.in("dossier_id", allIds)' src/routes/_authenticated/*.tsx` prints nothing.
- Manual: as admin, hard-reload `/dossiers`. It shows all dossiers immediately, not an empty list.

## Escape hatch

If `useRole()` exposes no `loading` flag at that point, STOP and report it.
