# 006: Verification baseline: single lockfile, typecheck script, CI, first test

| Field | Value |
|---|---|
| Written against | `origin/main` @ `c620189` (2026-10-26) |
| Priority | P1, prerequisite for any refactor (pagination, team emails, etc.) |
| Effort | S |
| Depends on | none. Recommended **before** future structural plans. |
| Status | TODO |

## Why this matters

- There is **no** test, no `test` or `typecheck` script, and no CI on `main` (no `.github/`). `package.json`
  `scripts` only contains `dev`, `build`, `build:dev`, `preview`, `lint`, `format` and `cap:*`.
- Of the 1,965 commits on `main`, about 1,955 are by `gpt-engineer-app[bot]` (Lovable), pushed straight
  to production with no automated check.
- There are two lockfiles. `bun.lock` is current (last changed 2026-10-16) and is the one Lovable uses;
  it pulls packages from Lovable's npm cache. `package-lock.json` has been stale since 2026-07-09: it
  has no `xlsx`, `jszip` or `@capacitor/*`. Any `npm ci` (README, MOBILE.md, `codemagic.yaml` on the
  `chore/ios-build-setup` branch) installs something different from production, or fails.
- `tsconfig.json` is `strict: true`, but nothing runs `tsc`.

## Target state

1. **Bun** is the only package manager (Lovable uses it, and `bunfig.toml` holds the 24 h
   supply-chain guard). `package-lock.json` is deleted.
2. `package.json` scripts: `typecheck` (`tsc --noEmit`) and `test` (`vitest run`).
3. A GitHub Actions workflow runs install, typecheck, lint, test and build on every push and PR to
   `main`. It is **non-blocking** for steps that already fail on the baseline (see step 2).
4. A first unit test on a pure module (`src/lib/dossier-progress.ts`), so the test runner exists.

## Steps

Branch: `git switch -c improve/006-ci origin/main`.

### Step 1: measure the baseline (before any change)

Run in the worktree and **write the results down in the PR description**:

```sh
bun install --frozen-lockfile                   # must exit 0
bunx tsc --noEmit 2>&1 | tail -3                # number of errors: N_TSC
bunx tsc --noEmit 2>&1 | grep -c "error TS"     # N_TSC
bun run lint 2>&1 | tail -5                     # number of problems: N_LINT
bun run build                                   # must exit 0
```

If `bun install --frozen-lockfile` or `bun run build` fails on the **unchanged** code → STOP and
report. The baseline itself is broken, and this plan does not cover repairing it.

### Step 2: scripts and lockfile

1. `package.json`, `scripts` section: add these two entries without touching the others:
   ```json
   "typecheck": "tsc --noEmit",
   "test": "vitest run"
   ```
2. Add `vitest` as a devDependency: `bun add -d vitest`. The 24 h guard in `bunfig.toml` applies. If
   it blocks the latest version, accept the version bun picks. **Never** add an exclusion to
   `minimumReleaseAgeExcludes`.
3. Delete `package-lock.json` (`git rm package-lock.json`).
4. `README.md`, "Development" section (end of file, the `npm i` / `npm run dev` code block): replace
   with `bun install` / `bun run dev`, and add a line listing the checks: `bun run typecheck`,
   `bun run lint`, `bun run test`, `bun run build`. Do not touch the rest of the README (product
   brief).

### Step 3: first test

Create `src/lib/dossier-progress.test.ts`. It tests the exports of `src/lib/dossier-progress.ts`
(file excerpt):

```ts
export const ETAPES_TOTAL = 3;
export function etapesActives<T extends { statut: string }>(taches: T[] | null | undefined): T[]
export function etapesTerminees(taches: EtapeLite[]): number            // capped at 3, ignores "annule"
export function computeAvancement(taches: EtapeLite[], dossierStatut?: string | null): number
                                                                       // termine/valide → 100
export function etapesLabel(taches: EtapeLite[]): string               // "Étapes du dossier (X/3)"
export function etapesLabelFromPercent(avancement: number | null | undefined): string
```

Minimum cases (`import { describe, it, expect } from "vitest"`):
- `computeAvancement([], null)` → `0`
- 1 step `termine` + 1 `annule` → `computeAvancement` → `33`
- 4 steps `termine` → `etapesTerminees` → `3`, `computeAvancement` → `100`
- `computeAvancement([], "valide")` → `100`; `computeAvancement([], "termine")` → `100`
- `etapesLabel([{ statut: "termine" }])` → `"Étapes du dossier (1/3)"`
- `etapesLabelFromPercent(null)` → `"Étapes du dossier (0/3)"`; `etapesLabelFromPercent(150)` → `"Étapes du dossier (3/3)"`

Vitest config: try **without** a config file first. If the `@/` alias breaks the import, import
with a relative path (`./dossier-progress`). Do not create a `vitest.config.ts` that re-imports
`@lovable.dev/vite-tanstack-config`: that would pull in the whole TanStack Start stack.

Check: `bun run test` → 1 file, all tests green.

### Step 4: GitHub Actions workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - name: Typecheck
        run: bun run typecheck
        continue-on-error: true   # TODO: set to false once N_TSC = 0
      - name: Lint
        run: bun run lint
        continue-on-error: true   # TODO: set to false once N_LINT = 0
      - run: bun run test
      - run: bun run build
```

Rules:
- If `N_TSC = 0` in step 1, **remove** `continue-on-error` from Typecheck. Same for Lint with
  `N_LINT`. Blocking only applies to steps that already pass.
- `build` and `test` are always blocking.
- No secrets in the workflow. The build must not need any. If it does (an error about a missing
  `VITE_SUPABASE_*`), add **only** the public variables as `env:` from `.env.example` on the
  `chore/ios-build-setup` branch, and report it.

### Out of scope

- Fixing existing tsc or lint errors.
- `codemagic.yaml` (it lives on `chore/ios-build-setup`, not on `main`). Tell the owner in the PR
  that this branch will need to switch from `npm ci` to `bun install --frozen-lockfile` before it is
  merged.
- `.gitignore` / `.env`: separate topic.

## Verification (done criteria)

| Command | Expected |
|---|---|
| `test -f package-lock.json; echo $?` | `1` (file absent) |
| `bun install --frozen-lockfile` | exits 0 |
| `bun run test` | exits 0, ≥7 tests passed |
| `bun run build` | exits 0 |
| `bun run typecheck 2>&1 \| grep -c "error TS"` | = N_TSC (no regression) |
| `grep -n '"typecheck"\|"test"' package.json` | 2 matches |
| `cat .github/workflows/ci.yml` | matches step 4 |

After the PR is pushed: the "CI" workflow appears under the PR's Checks and is green. Typecheck and
lint may show orange if non-blocking.

## STOP conditions

- `bun install --frozen-lockfile` fails because packages from the Lovable registry
  (`europe-west4-npm.pkg.dev/lovable-core-prod/...` in `bun.lock`) are not reachable from GitHub
  Actions → STOP. The CI needs another strategy (`bun install` without `--frozen-lockfile`, or a
  registry mirror). The owner decides.
- Lovable regenerates `package-lock.json` after a commit → report it. Don't fight with Lovable.

## Maintenance notes

- Every future plan can now require `bun run test` + `bun run build` as a gate.
- Next step once tsc reaches 0 errors: switch Typecheck to blocking. Good targets for the next tests
  (pure logic): `src/lib/notification-grouping.ts`, `src/lib/next-action.ts`,
  `src/lib/qualiopi-xlsx.ts`, `src/lib/cron-auth.ts` (after plan 001).
