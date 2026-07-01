## Alerte mot interdit — bannière + son en temps réel

Quand un message contient un mot bloqué (déjà détecté par `sanitize_message_content` et journalisé via `audit_logs` avec `action = 'message.flagged'`), les admins connectés voient immédiatement une bannière rouge en haut de l'écran et un son d'alerte est joué.

### 1. Base de données
Aucune migration nécessaire — le trigger `on_message_insert_security` insère déjà une ligne dans `audit_logs` avec :
- `action = 'message.flagged'`
- `severity = 'warning'`
- `metadata` = `{ reasons: [...], client_id: ... }`

On activera simplement la **réplication temps réel** sur `audit_logs` (via la migration si pas déjà fait) pour permettre l'écoute côté client.

### 2. Composant global `AdminFlaggedAlert`
Nouveau fichier `src/components/admin-flagged-alert.tsx` :
- Monté dans le layout admin (une seule fois, pour tous les admins connectés)
- S'abonne au canal Realtime `audit_logs` filtré sur `action=eq.message.flagged`
- Sur nouvel événement :
  - Joue un son d'alerte court (`/alert.mp3` généré ou son système via WebAudio API — bip synthétisé, pas de fichier externe)
  - Affiche une **bannière fixe rouge** en haut de la page avec :
    - Icône d'alerte
    - Nom du client concerné (résolu depuis `profiles`)
    - Mots-clés détectés (`reasons`)
    - Bouton « Voir la conversation » → `/admin/messages/:client_id`
    - Bouton « Fermer »
  - Empile plusieurs alertes si détections multiples (max 5 visibles, les autres en compteur)

### 3. Intégration
- Ajouter `<AdminFlaggedAlert />` dans `src/routes/_authenticated/admin.tsx` (layout admin) — visible uniquement pour rôles `admin`
- Vérifier le rôle via `has_role` avant d'activer l'abonnement (évite de le monter pour non-admins)

### 4. Son
Utiliser l'**API WebAudio** pour générer un bip d'alerte (deux tonalités successives 880Hz → 660Hz, 200ms chacune) — pas de fichier binaire à héberger, fonctionne offline. Le son ne se joue qu'après une première interaction utilisateur avec la page (contrainte navigateur).

### 5. Détails techniques
```text
Client message → trigger on_message_insert_security
  → sanitize (masque + flag)
  → INSERT audit_logs (action=message.flagged)
     ↓ Realtime broadcast
AdminFlaggedAlert (abonné) → bannière + WebAudio bip
```

- Filtre Realtime : `postgres_changes` INSERT sur `public.audit_logs` où `action = 'message.flagged'`
- Les bannières auto-disparaissent après 30s si non fermées manuellement
- État local uniquement (rechargement de page = bannières réinitialisées, l'historique reste dans `/admin/audit`)

### Hors périmètre
- Pas d'email
- Pas de notification dans la cloche (l'événement reste consultable dans `/admin/audit`)
- Pas de modification du filtrage/masquage existant
