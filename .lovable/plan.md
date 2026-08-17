# IZISuivis — Corrections & évolutions (11 points)

Le périmètre demandé est large. Je propose de le livrer en 5 lots, dans cet ordre, chacun testable.

## Lot 1 — Statuts, notifications & renommage (points 2, 9, 6)
- Workflow de dossier unifié : Demande créée → En cours de traitement → **Planification** → Audit réalisé → Clôturé (ajout des états manquants, migration sans perte des données existantes).
- À chaque changement d'état : notification in-app + e-mail au client **et** à Nadine (adresse configurable dans les réglages e-mail), avec anti-doublon par clé d'idempotence.
- Intitulés d'alertes normalisés : `IZISUIVI – Nouveau RDV`, `IZISUIVI – Nouvelle demande Qualiopi`, `IZISUIVI – Nouveau dossier EDOF`, `IZISUIVI – Contrôle à traiter`, avec pastille de couleur du pôle.
- Renommage automatique des titres : `NOM DE L'OF - DEMANDE EDOF` / `- DEMANDE QUALIOPI` / `- CONTRÔLE` / `- AUTRE`, appliqué à la création côté client et côté agence (nom de l'OF repris de la fiche client si absent du formulaire).

## Lot 2 — Calendrier Qualiopi automatique (point 3)
- Passage au statut **Planification** → création automatique d'un événement dans le Calendrier Qualiopi (client, OF, date, responsable, statut) et retrait du dossier de la liste « demandes en cours ».
- Lien bidirectionnel dossier ↔ événement (pas de doublon si l'événement existe déjà).

## Lot 3 — Contexte dans les conversations + historique (points 1, 4)
- Panneau latéral (ou bloc repliable sur mobile) dans la messagerie client, les groupes et les canaux internes : demandes liées, tâches associées, statut d'avancement, personnes assignées, pièces jointes.
- Historique « qui a fait quoi, quand » affiché sur les demandes, dossiers et tâches (créé par / modifié par + date-heure), alimenté par les journaux existants.

## Lot 4 — Tâches : pièces jointes, assignation multiple, rappels (points 5, 7, 10)
- Pièces jointes multiples sur les tâches (images, PDF, captures, autres), visibles dans la tâche, stockage sécurisé.
- Assignation multiple sur dossiers et tâches : chaque assigné reçoit les notifications du projet.
- Rappels automatiques par pôle avant échéance (tâche planifiée quotidienne), relance des responsables, sans doublon.

## Lot 5 — Google Drive (points 8, 11)
- Connexion Google Drive par utilisateur (connecteur officiel) ou compte agence unique — à confirmer.
- Classement automatique des documents déposés par le client : `Client / OF / Type de demande / Dossier`.
- Rangement des dossiers Qualiopi existants dans `QUALIOPI À FAIRE PASSER` (script de rangement + bouton manuel de vérification).

## Points techniques
- Migrations additives uniquement : aucun `DROP`, aucune donnée ni conversation supprimée.
- Toutes les notifications passent par la couche existante (`notifyEmail` + notifications in-app + web push) avec clé d'idempotence pour éviter les doublons.
- Automatisations serveur via server functions / triggers ; rappels via tâche planifiée.
- Tests du parcours complet : création demande → changement de statut → notifications client + Nadine → planification → calendrier → retrait des demandes en cours → classement Drive.

## À confirmer avant de démarrer
1. L'adresse e-mail exacte de Nadine (ou usage de l'e-mail admin déjà configuré).
2. Google Drive : compte unique de l'agence, ou chaque membre connecte son propre Drive ?
