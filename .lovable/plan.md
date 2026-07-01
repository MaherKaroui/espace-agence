## Objectif

Enrichir la catégorie **Qualiopi** avec 3 nouveaux documents requis, un champ **site web** sur la fiche du dossier, et permettre de **télécharger** ou **remplacer** chaque document requis directement depuis la liste.

## 1. Documents requis Qualiopi (`src/lib/labels.ts`)

Ajouter à la liste `qualiopi` :
- `factures` — « Factures » (match : `facture`)
- `bail` — « Bail commercial » (match : `bail`)
- `diplome` — « Diplôme(s) du dirigeant » (match : `diplome`, `diplôme`, `diploma`)

## 2. Champ site web sur le dossier

- Migration DB : ajouter `site_web TEXT` (nullable) à la table `dossiers`.
- Sur `dossiers.$id.tsx` (fiche dossier), afficher un champ URL éditable « Site web » (avec lien cliquable en lecture) — modifiable par le client propriétaire et l'admin, sauvegarde via mutation Supabase.

## 3. Refonte du composant `RequiredDocuments`

Pour chaque ligne :
- Si le document est **fourni** : afficher son nom + bouton **Télécharger** (icône `Download`) + bouton **Remplacer** (icône `Upload`) qui ouvre un file-picker et écrase le fichier existant.
- Si **manquant** : afficher bouton **Déposer** qui ouvre un file-picker, upload dans le bucket `documents` avec `detected_type = key` pour matching direct.

Techniquement :
- Passer les documents complets (`id`, `storage_path`, `nom`) au composant, pas juste `{nom, detected_type}`.
- Le composant reçoit aussi `dossierId` et un callback `onChanged` pour rafraîchir la liste après upload/remplacement.
- Téléchargement : `supabase.storage.from('documents').createSignedUrl(storage_path, 60)` → `window.open`.
- Remplacer : supprime l'ancien fichier + son enregistrement `documents`, puis upload le nouveau avec le même `detected_type`.
- Déposer (manquant) : upload standard avec `detected_type = requiredDoc.key`.

## 4. Sécurité

Les policies RLS existantes sur `documents` et `dossiers` couvrent déjà les cas (propriétaire + staff). Aucune modification RLS nécessaire ; l'ajout de `site_web` sur `dossiers` hérite des policies actuelles.

## Fichiers touchés

- `src/lib/labels.ts` — 3 lignes ajoutées à `qualiopi`
- `supabase/migrations/*_dossier_site_web.sql` — `ALTER TABLE dossiers ADD COLUMN site_web`
- `src/components/required-documents.tsx` — refonte avec boutons d'action
- `src/routes/_authenticated/dossiers.$id.tsx` — champ site web + passage des props enrichies à `RequiredDocuments`
