# IZISuivis

Je souhaite créer une nouvelle plateforme web professionnelle pour mon agence. L'objectif est de remplacer complètement les échanges WhatsApp par une plateforme centralisée où chaque client peut gérer ses dossiers, communiquer avec l'agence et suivre l'avancement de ses demandes.

Authentification

Créer un système d'authentification sécurisé avec :

Nom

Prénom

Adresse e-mail

Mot de passe

Fonctionnalités :

Vérification de l'adresse e-mail avant activation du compte.

Connexion sécurisée.

Réinitialisation du mot de passe.

Chaque utilisateur ne peut accéder qu'à son propre espace client.

Espace Client

Créer un tableau de bord moderne permettant au client de :

Consulter ses dossiers.

Déposer des documents.

Télécharger les documents envoyés par l'agence.

Voir les demandes en attente.

Suivre l'avancement de chaque dossier.

Consulter l'historique des échanges.

Les dossiers devront être classés par catégorie :

Qualiopi

BPF

NDA

CFA

VAE

EDOF

Contrats

Documents administratifs

Autres

Chaque dossier devra afficher un statut :

En attente

Documents manquants

En cours d'étude

En cours de traitement

À compléter

Validé

Refusé

Terminé

Chat intégré

Je ne souhaite plus utiliser WhatsApp.

Créer un véritable système de messagerie interne.

Fonctionnalités :

Discussion privée entre le client et l'agence.

Envoi de fichiers dans la conversation.

Aperçu des images et PDF.

Historique complet des conversations.

Horodatage des messages.

Indicateur "Message lu".

Indicateur "L'agence est en train d'écrire..."

Recherche dans les conversations.

Centre de notifications

Créer un système de notifications complet.

Notifications en temps réel :

Nouveau message reçu.

Nouveau document déposé.

Document validé.

Document refusé.

Demande de document complémentaire.

Changement du statut d'un dossier.

Nouveau commentaire de l'agence.

Activation du compte.

Vérification de l'e-mail réussie.

Rappel lorsqu'un dossier est incomplet.

Notification lorsqu'une action est attendue du client.

Notifications par e-mail :

Nouveau message.

Nouvelle demande de document.

Dossier validé.

Dossier terminé.

Rappel des documents manquants.

Confirmation de dépôt de document.

Prévoir une icône de notification (cloche) affichant le nombre de notifications non lues.

Les notifications devront être consultables dans un historique.

Module Qualiopi

S'inspirer du fonctionnement de :

https://geniequaliopi.lovable.app/

Créer un véritable assistant Qualiopi.

Le client doit pouvoir compléter progressivement son dossier.

Prévoir :

Les 7 critères Qualiopi.

Tous les indicateurs.

Une checklist de progression.

Les documents attendus pour chaque indicateur.

Les preuves à fournir.

Les modèles de documents.

Les procédures.

Les formulaires.

Les tableaux de suivi.

Les commentaires de l'agence.

Le taux d'avancement global.

Les documents validés.

Les documents manquants.

Module BPF

Créer un assistant BPF permettant de préparer toute la déclaration.

Prévoir les formulaires concernant :

Informations organisme.

Activité.

Nombre de stagiaires.

Nombre d'heures.

Répartition des financements.

Chiffre d'affaires.

Actions de formation.

CFA.

Bilans de compétences.

VAE.

Sous-traitance.

Pièces justificatives.

Afficher une checklist complète jusqu'à la finalisation du dossier.

Tableau de bord

Afficher :

Nombre de dossiers.

Nombre de documents.

Dossiers en attente.

Dossiers validés.

Documents manquants.

Dernières activités.

Derniers messages.

Notifications récentes.

Barre de progression de chaque dossier.

Espace Administrateur

Créer un espace réservé à l'agence.

Fonctionnalités :

Voir tous les clients.

Rechercher un client.

Voir tous les dossiers.

Consulter tous les documents.

Télécharger les pièces.

Modifier les statuts.

Envoyer des messages.

Ajouter des commentaires.

Demander des pièces complémentaires.

Gérer les notifications.

Recevoir des alertes dès qu'un client dépose un document.

Recevoir une notification dès qu'un nouveau client s'inscrit.

Tableau de bord avec statistiques.

Design

Je souhaite un design moderne, premium et très professionnel.

Style :

Interface fluide.

Responsive (ordinateur, tablette et mobile).

Couleurs :

Blanc

Bleu foncé

Gris clair

Doré discret

Icônes modernes.

Animations légères.

Expérience utilisateur simple.

Technique

Je souhaite que la plateforme soit développée avec :

Lovable

Supabase (authentification + base de données + stockage des fichiers + notifications temps réel)

Gestion des rôles (Client / Administrateur)

Stockage sécurisé des documents

Temps réel pour le chat et les notifications

Architecture évolutive afin de pouvoir ajouter ultérieurement d'autres services proposés par l'agence.

L'objectif est de créer une véritable plateforme SaaS professionnelle destinée aux organismes de formation, permettant de gérer intégralement les dossiers Qualiopi, BPF, NDA, CFA, VAE et autres démarches administratives, tout en centralisant la communication avec l'agence dans un seul outil sécurisé.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://espace-agence.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/51e3d791-7911-46e0-8fee-3de01cd0ad09).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
