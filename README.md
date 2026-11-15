# Kharait — Générateur de cartes mentales de séance

Application web HTML/CSS/JavaScript bilingue (arabe/français) : analyse des documents de séance, création de cartes mentales modifiables, impression et export PNG/PDF.

## 1. Déployer sur Vercel et sécuriser Gemini

1. Importer le dépôt GitHub dans Vercel.
2. Déployer la branche `feature/secure-backend-supabase` pour tester les modifications.
3. Dans **Vercel → Project → Settings → Environment Variables**, ajouter `GEMINI_API_KEY` avec la clé créée dans Google AI Studio.
4. Activer Production et Preview, enregistrer, puis redéployer.
5. Tester une génération avec un petit document.

La clé Gemini est utilisée uniquement par `api/generate.js`. Ne jamais la mettre dans le HTML, dans GitHub, ni dans une variable `NEXT_PUBLIC_*`.

La fonction vérifie le modèle, le contenu envoyé, la taille de requête, utilise une URL Google fixe, applique un délai d'attente et une limite basique de 8 requêtes/minute par IP et instance. Cette limite mémoire est best-effort : pour une application publique, remplace-la par un compteur partagé Upstash Redis ou équivalent. La taille totale des fichiers envoyés est limitée à 3 Mo pour rester dans les limites des fonctions Vercel.

## 2. Activer les comptes et la synchronisation multi-appareils

1. Créer un projet Supabase.
2. Dans **SQL Editor**, exécuter tout le contenu de `supabase/schema.sql`.
3. Dans **Authentication → Providers**, activer Email.
4. Dans **Project Settings → API**, copier l'URL du projet et la clé **anon/public**.
5. Ouvrir `supabase-config.js` dans GitHub et remplacer les deux valeurs d'exemple :
   - `url` : URL du projet Supabase.
   - `anonKey` : clé publique anon.
6. Dans **Authentication → URL Configuration**, ajouter le domaine Vercel dans les URL autorisées. Si la confirmation par e-mail est activée, configurer aussi le lien de redirection.
7. Redéployer le site.

À l'ouverture du site, l'écran de connexion bloque l'accès tant qu'aucune session Supabase valide n'existe. Crée ton compte, confirme l'e-mail si demandé, puis connecte-toi. La connexion est requise aussi côté API Gemini ; masquer simplement l'écran ne suffit pas. Une fois connecté, ouvrir **Compte / Synchronisation** puis cliquer sur **Enregistrer la carte actuelle**. Les cartes enregistrées apparaîtront dans la liste et pourront être ouvertes depuis un autre appareil après connexion.

**Sécurité :** le fichier de configuration ne contient que la clé publique anon. Ne jamais utiliser la clé `service_role` dans le navigateur. Les politiques Row Level Security de `supabase/schema.sql` garantissent que chaque utilisateur ne voit et ne modifie que ses propres cartes.

## 3. Fichiers importants

- `index.html` : interface, éditeur, authentification et synchronisation Supabase.
- `api/generate.js` : proxy serveur Gemini.
- `supabase/schema.sql` : table, index, trigger et politiques RLS.
- `supabase-config.js` : URL Supabase et clé publique anon (à configurer).
- `.env.example` : variable secrète Gemini à ajouter dans Vercel.
- `vercel.json` : en-têtes HTTP.

## 4. Ce qui reste à vérifier avant mise en production

Je ne peux pas exécuter le déploiement Vercel ni tester l'authentification contre ton projet Supabase sans tes paramètres de projet. Après avoir ajouté les clés, teste :
- génération Gemini ;
- création de compte, confirmation e-mail et connexion ;
- sauvegarde et ouverture d'une carte sur un deuxième appareil ;
- impression A4 et export PDF/PNG.

Le projet reste une application HTML/JS statique, sans migration Next.js. Les exports existants sont conservés.
