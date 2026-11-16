import { encryptSecret, json, authenticate } from "./_lib/credentials.js";

const allowed = ["gemini", "groq", "openrouter", "openai", "anthropic"];

export default async function handler(req, res) {
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const user = await authenticate(req);
    if (!user) return json(res, 401, { error: "Connectez-vous à Kharait." });

    if (req.method === "GET") {
      const response = await fetch(user.base + "/rest/v1/ai_credentials?select=provider&order=provider.asc", {
        headers: { apikey: user.pub, Authorization: user.authorization }
      });
      if (!response.ok) return json(res, 502, { error: "Impossible de lire les clés enregistrées." });
      const rows = await response.json();
      return json(res, 200, { providers: rows.map(row => row.provider) });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const provider = body.provider;
    if (!allowed.includes(provider)) return json(res, 400, { error: "Fournisseur non pris en charge." });

    const providerUrl = user.base + "/rest/v1/ai_credentials?provider=eq." + encodeURIComponent(provider);
    if (req.method === "DELETE") {
      const response = await fetch(providerUrl, {
        method: "DELETE",
        headers: { apikey: user.pub, Authorization: user.authorization }
      });
      if (!response.ok) return json(res, 502, { error: "Suppression impossible." });
      return json(res, 200, { ok: true });
    }

    if (typeof body.key !== "string" || body.key.length < 12 || body.key.length > 500 || /[\r\n]/.test(body.key)) {
      return json(res, 400, { error: "Clé API invalide." });
    }

    const secret = encryptSecret(body.key);
    const response = await fetch(user.base + "/rest/v1/ai_credentials", {
      method: "POST",
      headers: {
        apikey: user.pub,
        Authorization: user.authorization,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        user_id: user.id,
        provider,
        ...secret,
        updated_at: new Date().toISOString()
      })
    });
    if (!response.ok) return json(res, 502, { error: "Enregistrement impossible. Vérifiez la migration SQL Supabase." });
    return json(res, 200, { ok: true, provider });
  } catch (error) {
    if (error?.message === "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED") {
      return json(res, 503, { error: "Le chiffrement des clés n'est pas configuré sur Vercel." });
    }
    return json(res, 500, { error: "Erreur interne de stockage des clés." });
  }
}
