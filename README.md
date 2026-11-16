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

1. Importer le dépôt dans Vercel (branche `main`, preset « Other », sans commande de build).
2. Ajouter dans Vercel les variables `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` (Settings → Environment Variables), puis redéployer.
3. Dans Supabase : exécuter `supabase/schema.sql`, activer Email (Authentication → Providers) et ajouter `https://kharait.vercel.app` dans Authentication → URL Configuration.
4. Créer un compte, coller sa propre clé API et générer une carte avec un PDF léger (≤ 3 Mo).

**Gros PDF avec Gemini :** au-delà de 2,3 Mo, le navigateur téléverse le PDF d'origine (jusqu'à 50 Mo) directement vers l'API Fichiers de Gemini avec la clé de l'utilisateur, sans passer par Vercel ; le fichier est supprimé chez Google à la fin de la génération (sinon après 48 h). Si l'envoi direct échoue, le PDF est converti en images compressées.

**Limites :** une requête vers l'API ne doit pas dépasser ~4 Mo (limite Vercel). Les PPTX/DOCX sont lus dans le navigateur (texte, notes, SmartArt) : seul le texte et au plus 8 images compressées sont envoyés, quelle que soit la taille du fichier. Le nom de fichier de type `NE_AR_N3_P2_SEM3_S6` fournit niveau, phase, semaine et séance quand le document ne les contient pas.

**Testé :** la passerelle `/api/ai-generate` (authentification, refus des PDF pour OpenAI/Groq/OpenRouter, limite de débit, clé en en-tête uniquement) avec des fournisseurs simulés. Les appels réels aux cinq fournisseurs restent à valider avec les clés de leurs utilisateurs.


## 7. Audit de sécurité et confidentialité (novembre 2026)

- Le navigateur ne partage plus les cartes locales ni les clés IA entre deux comptes utilisés sur le même appareil : à la déconnexion ou au changement de compte, l'état privé local et la clé de fournisseur en mémoire sont effacés.
- Si la table `lesson_maps` est absente du cache PostgREST, l'interface affiche désormais la marche à suivre au lieu d'un message technique brut.
- Le schéma accorde explicitement les opérations de cartes au rôle `authenticated`, retire les droits du rôle `anon` et demande le rechargement du cache PostgREST.
- Les délais d'attente couvrent désormais aussi la lecture de la réponse du fournisseur, et le registre de limitation de débit nettoie ses anciennes entrées.
- Les modèles proposés dans l'interface ont été actualisés à partir des catalogues documentés des fournisseurs. Les identifiants peuvent toujours être remplacés manuellement, car leur disponibilité dépend du compte et du fournisseur.

**À faire après déploiement :** exécuter à nouveau `supabase/schema.sql` dans SQL Editor. Ce script est conçu pour être relancé. Les appels réels des fournisseurs doivent être vérifiés avec des clés de test individuelles.


## 8. حفظ مفاتيح الذكاء الاصطناعي لكل مستخدم

يدعم Kharait الآن حفظ مفتاح كل مزوّد مرة واحدة في حساب المستخدم، ثم استخدامه تلقائياً عند إنشاء الخرائط.

### إعداد مطلوب مرة واحدة في Vercel
أضف متغير البيئة `KHARAIT_CREDENTIALS_ENCRYPTION_KEY` بقيمة عشوائية Base64 تمثل 32 بايت. أنشئها محلياً بالأمر:

```bash
openssl rand -base64 32
```

لا تضع هذه القيمة في GitHub أو Supabase أو المتصفح، ولا تغيّرها بعد حفظ مفاتيح المستخدمين؛ تغييرها يمنع فك تشفير المفاتيح القديمة. احتفظ بنسخة احتياطية آمنة منها.

### ترحيل Supabase
أعد تشغيل `supabase/schema.sql` في SQL Editor لإنشاء جدول `ai_credentials` وسياسات RLS. لا يحتوي الجدول إلا على النص المشفّر وبيانات IV ووسم GCM، وليس مفاتيح API الأصلية.

### الاستخدام
من نافذة توليد الخريطة، اختر المزوّد، أدخل المفتاح مرة واحدة واضغط «حفظ المفتاح بأمان». سيعرض Kharait حالة الحفظ دون إعادة المفتاح إلى المتصفح. يمكن حذف المفتاح المحفوظ من الزر نفسه. مفاتيح OpenRouter المستلمة عبر OAuth تُحفظ بالطريقة نفسها بعد الضغط على زر الحفظ.

**تنبيه:** مفتاح التشفير الرئيسي على Vercel هو سر مركزي حساس؛ من يملكه مع صلاحية الوصول إلى قاعدة البيانات يستطيع فك تشفير المفاتيح. لا تسجّل المفاتيح أو النصوص المفكوكة في السجلات.
