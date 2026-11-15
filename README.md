# Kharait — Générateur de cartes mentales de séance

Application web statique HTML/CSS/JavaScript, bilingue arabe/français, pour analyser des documents de séance et créer des cartes mentales modifiables, imprimables et exportables.

## Déploiement Vercel

Le dépôt contient une fonction serveur `/api/generate`. Le navigateur ne reçoit plus la clé Gemini.

1. Importer ce dépôt dans Vercel et déployer la branche `feature/secure-backend-supabase`.
2. Dans **Vercel → Project → Settings → Environment Variables**, ajouter `GEMINI_API_KEY` avec une clé créée dans Google AI Studio.
3. Sélectionner Production et Preview, enregistrer, puis redéployer.
4. Ouvrir le site et tester une génération avec un petit PDF ou une image.

Ne jamais mettre la clé dans le HTML, dans GitHub, ni dans une variable `NEXT_PUBLIC_*`.

## Sécurité Gemini

- La clé est lue uniquement depuis `process.env.GEMINI_API_KEY`.
- Modèles autorisés par liste blanche.
- Validation des parties texte/média et limite de taille.
- Appels dirigés vers l'URL Google fixe, délai d'attente et réponses sans cache.
- Limitation de débit en mémoire (8 requêtes/minute par instance). Les fonctions serverless peuvent multiplier les instances : pour une protection de production fiable, ajouter un compteur partagé Upstash Redis ou équivalent.

## Stockage multi-appareils avec Supabase

Le schéma de base est préparé dans `supabase/schema.sql`.

1. Créer un projet Supabase.
2. Ouvrir **SQL Editor**, coller et exécuter `supabase/schema.sql`.
3. Activer Email/Password dans **Authentication → Providers**.
4. Renseigner l'URL du projet et la clé publique anon dans `supabase-config.js` (ce fichier ne doit contenir que la clé publique anon, jamais la clé service_role).

La table et les politiques Row Level Security isolent les cartes par utilisateur.

**État de l'intégration :** la structure SQL est prête, mais l'écran de connexion et la synchronisation des cartes dans l'interface ne sont pas encore implémentés. Tant que cette étape n'est pas terminée, les cartes et l'historique restent stockés dans le navigateur. Ne considère donc pas encore la synchronisation multi-appareils comme active.

## Fichiers

- `index.html` : interface et éditeur.
- `api/generate.js` : proxy serveur Gemini.
- `supabase/schema.sql` : table, index, trigger et politiques RLS.
- `.env.example` : variable secrète serveur.
- `vercel.json` : en-têtes et configuration Vercel.

## Limites actuelles

- L'application reste une application HTML/JS statique, pas une migration Next.js.
- Les exports PNG/PDF utilisent les bibliothèques CDN déjà présentes.
- La limite anti-abus en mémoire est best-effort et doit être remplacée par un stockage partagé avant un usage public important.
