# 004: Stop the step trigger from overwriting the dossier status

| Field | Value |
|---|---|
| Written against | `origin/main` @ `c620189` (2026-10-26) |
| Priority | P1, data bug |
| Effort | S (SQL) |
| Depends on | none |
| Status | TODO, **business rule to confirm with the owner first (see "Decision")** |

## Why this matters

The trigger `trg_tache_after_change` (`supabase/migrations/20260701083938_…sql:173-175`,
`AFTER INSERT OR UPDATE OR DELETE ON public.taches`) runs `public.recalc_dossier_from_taches()`. Its
current definition is in `supabase/migrations/20260819114550_18b6e595-a79a-4ae1-9689-a1f2a2076fc5.sql:57-94`
(no later migration redefines it):

```sql
  new_av := ROUND((LEAST(done, 3)::numeric / 3::numeric) * 100)::int;
  ...
  IF done >= total THEN new_statut := 'termine';
  ELSIF waiting_client > 0 THEN new_statut := 'a_completer';
  ELSIF in_progress > 0 OR done > 0 THEN new_statut := 'en_cours_traitement';
  ELSE new_statut := current_statut;
  END IF;

  PERFORM set_config('app.internal_recalc', '1', true);
  UPDATE public.dossiers SET avancement = new_av, statut = new_statut WHERE id = d_id;
```

Consequences:
1. Staff set a dossier to `valide`, `planification`, `audit_realise`, `refuse` or
   `documents_manquants`. The next edit to **any** step puts it back to `en_cours_traitement` (or
   `a_completer`, or `termine`). The status-change notification trigger then notifies the client
   **of the wrong status**.
2. A dossier with **fewer than 3** steps, all done, becomes `termine` while `avancement` = 33 or 67.
   That contradicts the model in `src/lib/dossier-progress.ts:1-35` ("3 étapes", `ETAPES_TOTAL = 3`,
   and `termine`/`valide` count as 100 %).

## Decision (owner confirms before execution; the default is applied when there is no answer)

**Default rule (recommended):**
- The trigger only **automatically changes** statuses that are still in the "working" phase:
  `en_attente`, `en_cours_etude`, `en_cours_traitement`, `a_completer`.
- Statuses set by staff are **never** overwritten by the trigger: `documents_manquants`, `valide`,
  `refuse`, `termine`, `planification`, `audit_realise`. The trigger still updates `avancement`.
- Automatic switch to `termine` only when `done >= 3`, i.e. the 3 steps of the model are done, and
  then `avancement = 100`.

If the owner wants a different rule (e.g. auto-`termine` allowed from `planification`), change only
the `v_auto_statuts` list below.

## Steps

Branch: `git switch -c improve/004-statut-dossier origin/main`.

Create `supabase/migrations/20261026122000_recalc_dossier_statut.sql`. It must sort after every
existing migration. Copy the **current** function **in full** from `20260819114550_…sql` (lines
57-94), then change **only** the status block and the UPDATE:

```sql
-- 004 : le recalcul par étapes ne réécrit plus un statut posé par l'équipe
CREATE OR REPLACE FUNCTION public.recalc_dossier_from_taches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d_id UUID; total INT; done INT; waiting_client INT; in_progress INT;
  new_av INT; new_statut public.dossier_statut; current_statut public.dossier_statut;
  d_client UUID; d_titre TEXT;
  v_auto_statuts public.dossier_statut[] := ARRAY['en_attente','en_cours_etude','en_cours_traitement','a_completer']::public.dossier_statut[];
BEGIN
  d_id := COALESCE(NEW.dossier_id, OLD.dossier_id);
  SELECT count(*) FILTER (WHERE statut NOT IN ('annule')),
         count(*) FILTER (WHERE statut = 'termine'),
         count(*) FILTER (WHERE statut = 'en_attente_client'),
         count(*) FILTER (WHERE statut = 'en_cours')
    INTO total, done, waiting_client, in_progress
    FROM public.taches WHERE dossier_id = d_id;
  IF total IS NULL OR total = 0 THEN RETURN COALESCE(NEW, OLD); END IF;
  new_av := ROUND((LEAST(done, 3)::numeric / 3::numeric) * 100)::int;
  SELECT statut, client_id, titre INTO current_statut, d_client, d_titre
    FROM public.dossiers WHERE id = d_id;

  IF current_statut IS NULL OR NOT (current_statut = ANY (v_auto_statuts)) THEN
    new_statut := current_statut;               -- statut posé par l'équipe : on n'y touche pas
  ELSIF done >= 3 AND done >= total THEN new_statut := 'termine';
  ELSIF waiting_client > 0 THEN new_statut := 'a_completer';
  ELSIF in_progress > 0 OR done > 0 THEN new_statut := 'en_cours_traitement';
  ELSE new_statut := current_statut;
  END IF;

  IF new_statut IN ('termine','valide') THEN new_av := 100; END IF;

  PERFORM set_config('app.internal_recalc', '1', true);
  UPDATE public.dossiers SET avancement = new_av, statut = new_statut
   WHERE id = d_id
     AND (avancement IS DISTINCT FROM new_av OR statut IS DISTINCT FROM new_statut);
  PERFORM set_config('app.internal_recalc', '', true);

  -- (keep the notification block 'tache_attente' EXACTLY as in 20260819114550, lines ~88-92)

  RETURN COALESCE(NEW, OLD);
END; $function$;
```

Important for the executor:
- The `IF TG_OP = 'UPDATE' AND NEW.statut = 'en_attente_client' …` block (notification
  `tache_attente`) must be **copied verbatim** from the source migration. Do not drop it.
- The added `AND (… IS DISTINCT FROM …)` avoids a no-op `UPDATE` that would fire downstream triggers
  for nothing.
- Do not recreate the trigger: `CREATE OR REPLACE FUNCTION` is enough.
- No TypeScript change is needed. `computeAvancement` in `src/lib/dossier-progress.ts` already
  treats `termine`/`valide` as 100 %.

### Out of scope

- `enforce_dossier_completion_consistency` (same source migration, lines 37-54): don't touch it.
- Correcting existing data (dossiers already overwritten in the past): **do not** run an automatic
  backfill. History cannot be reconstructed reliably. Provide the detection query below instead.

## Verification

Executor: `ls supabase/migrations | tail -1` → the new file. `grep -c "tache_attente"
supabase/migrations/20261026122000_recalc_dossier_statut.sql` → `1` (block kept).

Owner, after applying (SQL editor). Test in a transaction, then roll back:

```sql
BEGIN;
-- pick a dossier that has steps
WITH d AS (SELECT dossier_id FROM public.taches GROUP BY dossier_id HAVING count(*) >= 1 LIMIT 1)
UPDATE public.dossiers SET statut = 'valide' WHERE id = (SELECT dossier_id FROM d) RETURNING id;
-- touch a step of that dossier
UPDATE public.taches SET updated_at = now()
 WHERE id = (SELECT id FROM public.taches WHERE dossier_id = '<id returned above>' LIMIT 1);
SELECT statut, avancement FROM public.dossiers WHERE id = '<id>';   -- expected: statut = 'valide', avancement = 100
ROLLBACK;
```

Detecting dossiers that were probably overwritten (to review by hand):

```sql
SELECT d.id, d.titre, d.statut, d.avancement,
       (SELECT count(*) FROM taches t WHERE t.dossier_id = d.id AND t.statut <> 'annule') AS etapes
FROM dossiers d
WHERE d.statut = 'termine' AND d.avancement < 100;
```

## STOP conditions

- The function in `20260819114550_…sql` differs from the excerpt above (a later migration
  redefined it) → check with
  `grep -ln "FUNCTION public.recalc_dossier_from_taches" supabase/migrations/* drizzle/migrations/*.sql`.
  On `c620189` the output is 4 files, all **older than or equal to** `20260819114550`
  (`20260701083938`, `20260701085655`, `20260703133214`, `20260819114550`). If a **newer** file shows
  up, STOP and report.
- The owner did not confirm the rule and objects afterwards → the migration can be reverted by
  re-applying the function body from `20260819114550_…sql:57-94`.

## Maintenance notes

- Any new dossier status must be classified: "auto" (`v_auto_statuts`) or "manual".
- If the number of steps stops being 3, update `ETAPES_TOTAL` (TS) **and** the `3` constants in this
  function together.
