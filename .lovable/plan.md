## Objectif
Rendre le rendu des pièces jointes image identique côté client (site publié) et côté agence (preview).

## Constat
- Le code de `src/components/chat-window.tsx` et `src/components/group-chat-window.tsx` est déjà aligné : détection image par mime **et** par extension (`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`…), aperçu image inline, bouton « Télécharger » sous chaque pièce jointe reçue via `downloadChatFileAttachment`.
- La capture de gauche vient du site **publié** (`espace-agence.lovable.app`), qui tourne sur une version plus ancienne (le `.jpg` s'affichait encore en carte fichier).
- La capture de droite (preview) montre déjà le comportement voulu.

## Action
1. Publier le projet (`preview_ui--publish`) pour propager le code actuel vers `espace-agence.lovable.app`.
2. Après ~1 min, rafraîchir l'onglet client : le `.jpg` s'affichera en aperçu image avec le bouton « Télécharger » sous chaque image reçue, exactement comme côté agence.

Aucune modification de code n'est nécessaire.
