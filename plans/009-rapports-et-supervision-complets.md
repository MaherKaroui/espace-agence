# 009: Reports and supervision: read past 1,000 rows, and use the Europe/Paris time zone

| Field | Value |
|---|---|
| Written against | `origin/main` @ `406bd10` (2026-11-17) |
| Priority | P1: reports and uptime statistics are silently wrong |
| Effort | M |
| Depends on | none |
| Status | TODO |

Branch: `git switch -c improve/009-rapports origin/main`.

## Why

PostgREST caps every response at **1,000 rows**, even when the code asks for `.limit(5000)`. The reports therefore cover only part of the data, with no error. For example, `health_checks` gets about 2,880 rows over 30 days, so roughly 20 days show 100% uptime.

## Step 1: server helper

Create `src/lib/fetch-all.server.ts`:

```ts
/** Reads every row of a query in pages of 1,000 (max `cap`, default 20,000). `build()` must return a NEW builder each call, already ordered by a stable column. */
export async function fetchAllRows<T>(build: () => any, cap = 20000): Promise<T[]>
```

- Loop `build().range(from, from + 999)`.
- `throw new Error(error.message)` on error.
- Stop when a page has fewer than 1,000 rows, or when `cap` is reached.

## Step 2: replace the capped calls (server code only)

Keep the filters and columns. Remove `.limit(N)` where N > 1000. Make sure an `.order(...)` exists, using `created_at` or `id`.

| File | Lines (≈) | Table |
|---|---|---|
| `src/lib/supervision.functions.ts` | 24, 41 | `health_checks` (30 d), `app_errors` (30 d) |
| `src/lib/daily-activity-report.server.ts` | 182-188, 675-693, 764-770, 1352-1367 | `agency_tasks`, `user_sessions`, `audit_logs`, `messages`… |
| `src/lib/activity-reports.functions.ts` | 60 | `agency_tasks` |
| `src/server/slackRobot.server.ts` | 299-302 | `slack_fichiers` |
| `src/lib/push.functions.ts` | 103 | (see the file) |

For `daily-activity-report.server.ts` ~764-770, `.in("task_id", <all ids>)` must go through 100-id chunks
(write a small chunk loop locally). Also check `error`.

Leave `.limit(N)` with N ≤ 1000 alone. Those limits are intentional.

## Step 3: time zone in `src/lib/direction-report.functions.ts`

- Lines ~68 and ~153-154 hard-code `T00:00:00+01:00`, which is wrong in summer time.
- Line ~21 takes "today" in UTC.

Reuse the existing helpers:
- `parisDateKey()` is exported from `src/lib/daily-activity-report.server.ts`.
- `parisOffsetMinutes` is in the same file. Export it.

Day start = midnight Paris converted to UTC:

```ts
const off = parisOffsetMinutes(new Date(`${date}T12:00:00Z`))
const startUtc = new Date(Date.parse(`${date}T00:00:00Z`) - off * 60000)
```

The end is `startUtc` + 24 h. The default date is `parisDateKey()`.

## Out of scope

UI files and SQL.

## Done criteria

- `npx tsc --noEmit 2>&1 | grep -E "fetch-all|supervision|daily-activity|activity-reports|slackRobot|push\.functions|direction-report"` prints nothing.
- `grep -rn "limit(5000)\|limit(3000)\|limit(2000)" src/lib src/server` prints nothing.
- `grep -n "+01:00" src/lib/direction-report.functions.ts` prints nothing.

## Escape hatch

If a capped query aggregates in JavaScript something that could be computed in SQL (`count`), you may use
`{ count: "exact", head: true }` instead. Do it only if the result is identical, and say so in the commit message.
