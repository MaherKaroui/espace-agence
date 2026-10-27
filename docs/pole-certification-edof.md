# Pôle Certification & EDOF — notice d'utilisation

Module de suivi des démarches auprès des **certificateurs** (titres RS) et des **référencements EDOF** auprès de la Caisse des Dépôts (CDC). Il s'ouvre depuis le menu **Agence → Certification & EDOF** (`/pole-certification`).

## 1. Accès et rôles

| Rôle | Ce qu'il peut faire |
|---|---|
| Administrateur / direction | Tout voir, créer, modifier, archiver, supprimer ; forcer une étape bloquée ; paramétrer étapes, rappels et types de pièces |
| Responsable de dossier | Créer ses dossiers (il en devient responsable), remplir les étapes, déposer les pièces, affecter des personnes, recevoir les rappels |
| Collaborateur (affecté au dossier) | Consulter et compléter le dossier |
| Lecture seule (affecté en « lecture », ex. audit Qualiopi) | Consulter le dossier et son historique, sans modifier |

Les membres des pôles **Certification** et **EDOF** (page Pôles) voient tous les dossiers du module en lecture. Le responsable est affiché partout (fiche, tableau, colonnes, calendrier). Un changement de responsable est noté dans l'historique (ancien → nouveau).

## 2. Créer un dossier

**Nouveau dossier** → type (Certificateur ou EDOF), nom de la certification ou de l'organisme, organisme, certificateur, code RS, date cible, notes. Les étapes par défaut sont créées automatiquement, la première démarre le jour même.

En fin de parcours Certificateur (étape 4 validée), la fiche propose **Créer le dossier EDOF lié**.

## 3. Étapes et statuts

Chaque étape a : numéro et intitulé (modifiables), statut, dates de début / échéance / réalisation, responsable, champ libre, pièces jointes, rappel, case « étape terminée ». On peut ajouter, renommer, supprimer (si jamais refusée) ou réordonner les étapes.

| Statut | Couleur | Effet |
|---|---|---|
| À faire | Gris | — |
| En cours | Bleu | Rappel si l'étape reste trop longtemps en cours (EDOF 3 : 7 jours) |
| En attente de réponse | Jaune | Relance proposée après X jours sans réponse, avec modèle de mail prérempli |
| Validé | Vert | L'étape suivante démarre et son responsable est notifié |
| Refusé | Rouge | Motif obligatoire ; notification immédiate au responsable et à la direction ; puis **Recours** ou **À recommencer** |
| Recours | Violet | Saisir le délai de recours |
| À recommencer | Orange | Nouvelle tentative (2, 3…) avec nouvelle échéance ; l'ancienne reste visible |

Rouge signale aussi une échéance dépassée, orange une pièce qui expire bientôt. Chaque couleur est accompagnée d'un libellé et d'une icône.

## 4. Pièces et validité de 3 mois

Chaque pièce a une date d'émission ; la péremption est calculée seule (émission + durée du type de pièce, 90 jours par défaut, modifiable). Statut : **Valide** (vert), **Expire bientôt** (orange, moins de 15 jours), **Périmé** (rouge). Une nouvelle version garde les précédentes.

- Check-list des pièces attendues par type de dossier : ce qui manque apparaît en rouge.
- L'étape **EDOF 4 « Déposer les documents »** ne peut pas être validée si une pièce est périmée. Seul un administrateur peut forcer, avec un motif, et le forçage est inscrit dans l'historique.
- Après un refus, le compte à rebours des pièces s'applique à la nouvelle date d'envoi : une pièce valide au premier envoi peut être périmée au second.

## 5. Rappels

| Déclencheur | Qui | Canal |
|---|---|---|
| Échéance d'étape dans 3 jours, puis le jour J | Responsable de l'étape | Notification + mail |
| Échéance dépassée | Responsable + direction | Notification + mail, puis tous les 2 jours |
| Pas de réponse après X jours | Responsable | Notification (modèle de relance sur la fiche) + mail |
| Pièce qui expire dans 15 puis 7 jours, ou périmée | Responsable | Notification + mail |
| Pièce qui sera périmée à la date d'envoi prévue | Responsable | Notification + mail |
| Lien / code CDC qui expire | Responsable | Notification + mail 2 jours avant |
| Visio, webinaire | Responsable + personnes affectées | La veille et 1 h avant |
| Étape validée | Responsable de l'étape suivante | Notification « étape suivante à lancer » |
| Refus | Responsable + direction | Notification immédiate |

- **Reporter le rappel** : 1 jour, 3 jours ou une date choisie, sur une étape ou une pièce.
- **Récapitulatif chaque lundi matin** par mail : échéances de la semaine, pièces qui expirent, dossiers en retard.
- Les délais et le canal mail se règlent par type de dossier et par étape dans **Paramètres**. Chaque personne peut couper la catégorie « Pôle Certification & EDOF » dans **Préférences**.

## 6. Vues

Les filtres sont communs aux quatre vues : type, responsable, statut, certificateur, période, archives.

- **Tableau de bord** : compteurs (en cours, en attente, refusés, validés ce mois-ci), « à faire aujourd'hui / cette semaine » par responsable, pièces qui expirent, dossiers en retard.
- **Tableau** : une ligne par dossier, tri, filtre et recherche par colonne, cellules colorées, export **Excel (.xlsx)** et **PDF**.
- **Colonnes** : une colonne par étape, cartes colorées à glisser vers l'étape suivante (ce qui valide l'étape en cours).
- **Calendrier** : vues mois, semaine et jour (échéances, visios, webinaires, péremptions, expiration des liens CDC). Un clic ouvre le dossier. L'export **.ics** s'importe dans Google Agenda ou Outlook.

## 7. Historique et Qualiopi

Toute action est horodatée et attribuée à son auteur : création, changement de statut, modification d'un champ libre, dépôt ou nouvelle version de pièce, report de rappel, forçage administrateur, affectations. Le journal de la fiche s'exporte en PDF. Les tentatives refusées et les recours ne sont jamais effacés. Un dossier archivé reste consultable mais n'est plus modifiable. Ces traces servent de preuves lors d'un audit Qualiopi.

## 8. Paramètres (direction / admin)

- Étapes types Certificateur et EDOF : intitulé, aide à la saisie, délai de relance, rappel « en cours », visio / webinaire, expiration du lien, blocage si pièce périmée, cases à cocher, canal mail, active. Ces réglages s'appliquent aux **nouveaux** dossiers.
- Types de pièces : libellé, validité en jours (vide = sans péremption), types de dossier, obligatoire.
- **Version de test** : crée deux dossiers « [DÉMO] » parcourus de bout en bout (un refus suivi d'une nouvelle tentative, un refus suivi d'un recours), puis les supprime d'un clic.

## 9. Questions à trancher : réponses retenues

- **Délais de relance 7 / 15 jours** : ce sont les valeurs par défaut, réglables par étape dans Paramètres.
- **SMS** : non inclus (notification + mail uniquement).
- **Agenda** : export `.ics`, compatible Google Agenda et Outlook. Une synchronisation automatique en temps réel n'est pas incluse.

## 10. Référencement EDOF : rappel des exigences officielles

Source : [of.moncompteformation.gouv.fr — Démarrer sur EDOF](https://of.moncompteformation.gouv.fr/espace-public/demarrer-sur-edof).

**Prérequis** (cases de l'étape 0) :
- formations éligibles au CPF ;
- NDA actif (Mon Activité Formation) ;
- certification Qualiopi ;
- habilitation du certificateur pour les formations RS / RNCP ;
- agrément ministériel s'il y a lieu ;
- obligations légales à jour (BPF, comptes) ;
- CGU acceptées.

**Pièces de moins de 3 mois à la date de la demande** :
- **Société** : Kbis ou extrait RNE.
- **Association** : statuts à jour avec les membres du bureau, dernier PV d'AG et récépissé JOAFE.
- **Représentant légal** : pièce d'identité recto / verso et déclaration de non-condamnation et de filiation.
- **Selon l'activité** : agrément préfectoral (auto-école) ou agrément ministériel (formation des élus).

Formats acceptés : PDF, PNG, JPG, JPEG, GIF, BMP.

**Démarche CDC** :
1. Compte EFP Connect, puis demande d'habilitation à `drca_mcf_OF_N1@caissedesdepots.fr`, avec les pièces envoyées via France Transfert. Le code reçu nomme le « Responsable des accès EDOF ».
2. Formulaire de demande de référencement sur EDOF, pour le SIRET concerné.
3. Pièces complémentaires demandées par la CDC.
4. Décision, à télécharger sur EDOF.

**Après acceptation** (étape 6, environ 48 h après) :
- habilitations des collaborateurs ;
- coordonnées bancaires ;
- contacts de l'organisme ;
- catalogue de formations ;
- clôture de l'ancien SIRET si besoin.
