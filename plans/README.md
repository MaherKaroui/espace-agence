# Plans d'amélioration — IZISuivis (`espace-agence`)

Audit `/improve` du 2026-10-26 sur `origin/main` @ **`c620189`**, complété le 2026-11-17 @ **`406bd10`** (plans 007-010).
Chaque plan est autonome. L'exécutant travaille sur une branche `improve/NNN-…` créée depuis
`origin/main`, **jamais** directement sur `main` (Lovable synchronise `main`). Les migrations SQL sont
écrites dans `supabase/migrations/` et **appliquées par le propriétaire** (Lovable Cloud).

> Les plans de sécurité (001, 002, puis S1-S3 du 17/11) sont conservés hors du dépôt tant que le dépôt est public.

## Ordre d'exécution & statut

| # | Plan | Priorité | Effort | Dépend de | Statut |
|---|---|---|---|---|---|
| 003 | [E-mails équipe/groupe côté serveur](003-emails-equipe-cote-serveur.md) | P1 bug | M | — | FAIT (17/11) — envoi côté serveur, aucune adresse renvoyée au navigateur |
| 004 | [Le trigger d'étapes n'écrase plus le statut dossier](004-trigger-statut-dossier.md) | P1 données | S | règle métier à confirmer | SQL prêt, NON appliqué (règle par défaut) — à appliquer par le propriétaire |
| 005 | [Petits bugs : accusés de lecture, remplacement de document, heure RDV](005-petits-bugs-chat-docs-rdv.md) | P1 | S | — | FAIT (déjà fusionné avant le 17/11) |
| 006 | [Socle de vérification (bun, CI, premier test)](006-ci-verification-de-base.md) | P1 DX | S | — | FAIT (17/11) — bun seul, `bun run typecheck`/`test`, CI GitHub Actions (lint non bloquant) |
| 007 | [Messageries au-delà de 1 000 messages](007-messageries-au-dela-de-1000.md) | P1 bug | S | — | FAIT (17/11) |
| 008 | [Listes de dossiers fiables (rôle, `.in()` par paquets)](008-listes-dossiers-fiables.md) | P1 bug | M | — | FAIT (17/11) |
| 009 | [Rapports et supervision complets, fuseau Paris](009-rapports-et-supervision-complets.md) | P1 bug | M | — | FAIT (17/11) — reste `supervision.server.ts` (computeAnomalies) |
| 010 | [Relances, notifications, poids du logo](010-relances-et-allegements.md) | P2 | S | — | FAIT sauf double notification (la cloche affiche aussi la notification navigateur : à arbitrer) |

004, 005, 006 sont indépendants ; 006 avant tout futur refactor structurel.
Statuts : `TODO` → `EN COURS` → `FAIT` / `BLOQUÉ` / `PÉRIMÉ`.

## Pistes produit (à arbitrer)

Module **BPF** réel (formulaires Cerfa ; aujourd'hui `bpf` n'est qu'une catégorie), **supervision des
crons** (tables `health_checks` / `cron_jobs_health` déjà présentes), **modèles d'étapes**
(`tache_templates` existe, inutilisée).

## Écartés (17/11)

`.env` suivi par Git : ne contient que des valeurs publiques (vérifié le 31/08) — pas une faille. Doublon de logique des 3 kanbans et fichiers > 1 000 lignes : dette réelle mais refonte risquée sans tests (après 006).

## Non audité

Projets natifs `android/` et `ios/` ; base en production (seules les migrations ont été lues).
