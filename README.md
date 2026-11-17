# Kharait — Générateur de cartes mentales de séance

Application web HTML/CSS/JavaScript bilingue (arabe/français) pour analyser des documents pédagogiques, créer des cartes mentales modifiables, organiser les étapes et durées, puis exporter en PNG/PDF ou imprimer en A4.

## Architecture

- Frontend statique : `index.html` (pas de framework/build requis).
- Backend serverless Vercel : `api/ai-generate.js` et `api/ai-credentials.js`.
- Authentification et stockage cloud : Supabase Auth + Postgres avec RLS.
- IA BYOK : Gemini, Groq, OpenRouter, OpenAI et Anthropic. Chaque utilisateur utilise sa propre clé.

## Configuration Supabase et Vercel

1. Créez un projet Supabase et exécutez `supabase/schema.sql` dans SQL Editor.
2. Activez Email dans Authentication → Providers.
3. Configurez `supabase-config.js` avec l'URL du projet et la clé publique Publishable/anon. N'y placez jamais la clé Secret/service_role.
4. Dans Vercel, ajoutez `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`.
5. Générez une clé de chiffrement de 32 octets en Base64 avec `openssl rand -base64 32` (ou Node.js).
6. Ajoutez cette valeur à Vercel sous `KHARAIT_CREDENTIALS_ENCRYPTION_KEY`. Variable serveur uniquement, sans préfixe `NEXT_PUBLIC_`.
7. Ajoutez le domaine de production et les URLs de preview nécessaires dans Supabase Auth → URL Configuration, puis redéployez.

**Sauvegardez la clé de chiffrement hors de Vercel et conservez-la stable.** Si elle est perdue ou remplacée sans migration des secrets, les clés IA déjà enregistrées ne pourront plus être déchiffrées.

## Fournisseurs et clés IA personnelles

Dans « Générer une carte » :
- Choisissez Gemini, Groq, OpenRouter, OpenAI ou Anthropic.
- Collez votre clé personnelle puis cliquez sur « حفظ المفتاح بأمان » pour l'enregistrer.
- La clé est chiffrée côté serveur avec AES-256-GCM avant son insertion dans `ai_credentials`.
- L'API ne renvoie jamais la clé déchiffrée au navigateur. Elle renvoie uniquement la liste des fournisseurs enregistrés.
- La génération récupère et déchiffre la clé côté serveur pour l'utilisateur authentifié. La clé n'est pas intégrée aux cartes.
- La suppression d'une clé s'effectue depuis le même écran. OpenRouter OAuth utilise PKCE.

Chaque fournisseur facture directement son propre compte. Un abonnement ChatGPT Plus ne comprend pas automatiquement des crédits API OpenAI. La disponibilité des modèles dépend du compte, de la région, du quota et des conditions du fournisseur ; les suggestions intégrées sont des identifiants de départ, pas une garantie d'accès. L'utilisateur peut saisir un autre ID disponible dans son compte.

## Import automatique depuis Raeda

Dans « Générer une carte », la section **« Importer automatiquement depuis Raeda »** permet de choisir semaine, séance, matière et niveau, de récupérer la liste des séances publiées sur https://raeda.alistic.net/ puis d'ajouter les PPTX sélectionnés aux fichiers de la séance, sans téléchargement manuel.

- Route serverless : `api/raeda-import.js` (`action=list` et `action=file`), réservée aux utilisateurs connectés. Elle ne contacte que `raeda.alistic.net`, valide strictement ses paramètres et télécharge un seul fichier à la fois, à la demande.
- La liste est lue depuis `slides.php?sem=…&seance=…&subject=…&view=table` (liens `download.php?course=…`). Si Raeda change la structure de ses pages, adapter `extractCourseCodes` dans ce fichier.
- Les fichiers sont renommés `NE_AR_N1_P2_SEM4_S1.pptx` pour que l'indice niveau/phase/semaine/séance soit transmis au modèle.
- Limite : les réponses des fonctions Vercel sont plafonnées à ~4,5 Mo. Un PPTX plus gros est refusé avec un message clair ; il faut alors le télécharger puis l'ajouter à la main.

## Sécurité et confidentialité

- Les routes IA vérifient le jeton Supabase côté serveur.
- Les clés personnelles sont chiffrées avant stockage et isolées par utilisateur via RLS.
- Les clés ne doivent jamais être placées dans le dépôt, les logs, les cartes ou les variables publiques.
- Les réponses API utilisent `Cache-Control: no-store`.
- Le service worker ne met en cache ni `/api/*`, ni les requêtes non statiques, ni les réponses marquées `private/no-store`. Seule l'enveloppe statique de l'application peut être disponible hors ligne.
- La limite de débit de l'API est en mémoire et reste best-effort entre instances serverless ; pour une application publique à grande échelle, utiliser un compteur partagé (Redis/Upstash).

## Fichiers et limites

- Gemini et Anthropic acceptent les PDF dans l'adaptateur actuel.
- OpenAI, Groq et OpenRouter reçoivent texte et images ; les PDF directs ne sont pas pris en charge par cette route.
- Les fichiers volumineux peuvent être envoyés directement à l'API Files de Gemini par le navigateur avec la clé personnelle de l'utilisateur, selon les limites du fournisseur.
- Les PPTX/DOCX sont extraits côté navigateur ; le contenu texte et les images compressées sont transmis au modèle.

## Vérifications avant mise en production

- Tester inscription, connexion, déconnexion et changement de compte sur un navigateur partagé.
- Tester sauvegarde, chargement, suppression d'une clé personnelle pour chaque fournisseur.
- Tester la génération avec au moins un modèle actif par fournisseur et un PDF pour Gemini/Anthropic.
- Tester sauvegarde cloud des cartes, ouverture depuis un autre appareil, export PNG/PDF et impression A4.
- Vérifier dans DevTools → Application → Cache Storage qu'aucune route API ou donnée de compte n'est mise en cache.
