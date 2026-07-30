# IZISuivis — Applications Android & iOS (Capacitor)

Une seule base de code, un seul backend, une seule base de données, les mêmes
utilisateurs. Les applications natives affichent le site publié
(`https://izisuivis.com`) : **chaque publication depuis Lovable est
immédiatement visible sur mobile**, sans recompiler ni republier sur les stores.

## Mise en place (à faire une seule fois, sur votre ordinateur)

1. Exportez le projet vers GitHub, puis `git clone` en local.
2. `npm install`
3. `npx cap add android` et/ou `npx cap add ios`
4. `npx cap sync`
5. Lancer :
   - Android : `npx cap run android` (Android Studio requis)
   - iOS : `npx cap run ios` (macOS + Xcode requis)

## Mises à jour

Après une publication Lovable : rien à faire, l'app mobile est à jour au
prochain lancement. Une recompilation n'est nécessaire que si l'on ajoute un
plugin natif ou si l'on change `capacitor.config.ts`.

## Développement en direct (optionnel)

Pour tester votre preview Lovable dans l'app, remplacez temporairement
`server.url` dans `capacitor.config.ts` par l'URL de preview, puis `npx cap sync`.

## Ce qui est déjà géré dans le code

- Safe Areas iPhone (`pt-safe`, `pb-safe`, `viewport-fit=cover`)
- Barre de navigation inférieure sur mobile (`src/components/mobile-bottom-nav.tsx`)
- Bouton Retour Android + splash screen + status bar + clavier
  (`src/lib/native.ts`, `src/components/native-bootstrap.tsx`)
- Optimisation tactile (cibles 44px, pas de zoom iOS sur les champs)
- Caméra native optionnelle via `takePhotoFile()` (retombe sur l'input fichier Web)
- Auth, temps réel, stockage et notifications : identiques Web et mobile

## Orientation portrait

- Android : dans `android/app/src/main/AndroidManifest.xml`, ajouter
  `android:screenOrientation="portrait"` sur l'activité principale.
- iOS : dans Xcode, Target → General → Device Orientation, cocher uniquement
  « Portrait ».
