# Plans d'amélioration — IZISuivis (`espace-agence`)

Audit `/improve` du 2026-10-26 sur `origin/main` @ **`c620189`**.
Chaque plan est autonome. L'exécutant travaille sur une branche `improve/NNN-…` créée depuis
`origin/main`, **jamais** directement sur `main` (Lovable synchronise `main`). Les migrations SQL sont
écrites dans `supabase/migrations/` et **appliquées par le propriétaire** (Lovable Cloud).

> Deux plans de sécurité (001, 002) sont conservés hors du dépôt tant que le dépôt est public.

## Ordre d'exécution & statut

| # | Plan | Priorité | Effort | Dépend de | Statut |
|---|---|---|---|---|---|
| 003 | [E-mails équipe/groupe côté serveur](003-emails-equipe-cote-serveur.md) | P1 bug | M | — | TODO |
| 004 | [Le trigger d'étapes n'écrase plus le statut dossier](004-trigger-statut-dossier.md) | P1 données | S | règle métier à confirmer | TODO |
| 005 | [Petits bugs : accusés de lecture, remplacement de document, heure RDV](005-petits-bugs-chat-docs-rdv.md) | P1 | S | — | EN REVUE — branche `improve/005-petits-bugs` (3 commits, revue OK). Avant fusion : contrôle SQL `from_agence IS NULL` + tests manuels A/B en preview. |
| 006 | [Socle de vérification (bun, CI, premier test)](006-ci-verification-de-base.md) | P1 DX | S | — | TODO |

004, 005, 006 sont indépendants ; 006 avant tout futur refactor structurel.
Statuts : `TODO` → `EN COURS` → `FAIT` / `BLOQUÉ` / `PÉRIMÉ`.

## Pistes produit (à arbitrer)

Module **BPF** réel (formulaires Cerfa ; aujourd'hui `bpf` n'est qu'une catégorie), **supervision des
crons** (tables `health_checks` / `cron_jobs_health` déjà présentes), **modèles d'étapes**
(`tache_templates` existe, inutilisée).

## Non audité

Projets natifs `android/` et `ios/` ; base en production (seules les migrations ont été lues).
