# Kharait — Générateur de cartes mentales de séance

Application web HTML/CSS/JavaScript bilingue (arabe/français) : analyse des documents de séance, création de cartes mentales modifiables, impression et export PNG/PDF. Authentification Supabase et BYOK (Bring Your Own Key).

## 1. Configuration Supabase

1. Créer un projet Supabase.
2. Exécuter `supabase/schema.sql` dans SQL Editor.
3. Activer Email dans Authentication → Providers.
4. Renseigner l'URL et la clé Publishable du projet dans `supabase-config.js`.
5. Dans Vercel, ajouter `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` (la clé Publishable est prévue pour être exposée au navigateur ; jamais la clé Secret/service_role).
6. Ajouter le domaine Vercel aux URL autorisées dans Supabase Auth.

L'écran de connexion est obligatoire. L'API serveur vérifie le jeton Supabase avant chaque génération IA.

## 2. BYOK : chaque utilisateur utilise son propre fournisseur IA

Kharait ne nécessite plus de clé Gemini commune ni de clé IA appartenant au propriétaire du site. Chaque utilisateur ouvre **Générer une carte**, choisit son fournisseur, puis :
- colle sa propre clé API ; ou
- utilise **Connecter OpenRouter (OAuth)** pour autoriser son compte OpenRouter via PKCE.

Fournisseurs proposés :
- Google Gemini
- Groq
- OpenRouter
- OpenAI
- Anthropic Claude

Les clés sont conservées uniquement dans la mémoire de la page active. Elles ne sont ni écrites dans localStorage/sessionStorage, ni envoyées à Supabase, ni enregistrées dans les cartes. Elles sont transmises en HTTPS dans un en-tête dédié au proxy Vercel, utilisées pour l'appel au fournisseur, puis abandonnées. Fermer ou recharger l'onglet efface la clé de la mémoire ; l'utilisateur doit la ressaisir ou reconnecter OpenRouter.

**OAuth :** OpenRouter prend en charge la connexion OAuth PKCE sans demander le mot de passe OpenRouter à Kharait. Les autres fournisseurs sont proposés par clé API personnelle ; ils n'ont pas de flux OAuth générique intégré dans cette version.

**Fichiers :** Gemini et Anthropic acceptent les documents PDF transmis ici. Pour OpenAI, Groq et OpenRouter, l'API commune transmet texte et images ; les PDF directs ne sont pas pris en charge par cette route et l'interface renverra un message explicatif. Les modèles vision dépendent du fournisseur et du modèle choisis.

Chaque fournisseur facture directement son propre utilisateur selon son compte, son quota et ses conditions. Un abonnement ChatGPT Plus, par exemple, ne donne pas automatiquement des crédits API OpenAI.

## 3. Sécurité

- `api/ai-generate.js` vérifie la session Supabase, limite la taille, valide les formats et utilise des URL fournisseurs fixes.
- La clé utilisateur arrive dans l'en-tête `X-Kharait-Provider-Key`, pas dans le JSON du corps.
- Aucune clé fournisseur n'est enregistrée côté serveur ou dans la base de données par Kharait.
- Les réponses API sont marquées `no-store`.
- L'ancienne route `/api/generate` (clé Gemini partagée) est désactivée.
- La limite de débit en mémoire est best-effort entre instances serverless ; utiliser Redis partagé pour un service public à grande échelle.

Important : comme pour toute application web, un utilisateur peut voir sa propre clé dans les outils développeur pendant qu'il l'utilise. Ne pas utiliser un ordinateur partagé non fiable et révoquer une clé si elle est suspectée compromise.

## 4. Stockage cloud des cartes

Les cartes peuvent être sauvegardées dans Supabase. Les politiques Row Level Security de `supabase/schema.sql` isolent les données de chaque utilisateur. Les clés IA ne sont jamais incluses dans les cartes sauvegardées.

## 5. Fichiers importants

- `index.html` : interface, connexion, choix du fournisseur, saisie de clé et OAuth OpenRouter.
- `api/ai-generate.js` : passerelle BYOK authentifiée vers les cinq fournisseurs.
- `api/generate.js` : ancienne route désactivée.
- `supabase/schema.sql` : table de cartes et politiques RLS.
- `supabase-config.js` : URL Supabase et clé publique Publishable.
- `.env.example` : variables serveur Supabase uniquement.
- `vercel.json` : en-têtes HTTP.

## 6. Déploiement et tests

1. Déployer la branche `feature/secure-backend-supabase`.
2. Configurer les variables Supabase dans Vercel.
3. Compléter `supabase-config.js`, exécuter le SQL et créer un compte Kharait.
4. Tester chaque fournisseur avec une clé de test personnelle, d'abord avec un prompt court.
5. Tester OAuth OpenRouter et vérifier qu'une actualisation de page efface la clé de l'état en mémoire.

Le code est préparé sur la branche de travail, mais le déploiement Vercel et les appels réels aux cinq fournisseurs doivent encore être testés avec les comptes de leurs utilisateurs.