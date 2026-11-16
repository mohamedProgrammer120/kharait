// BYOK AI gateway for Kharait.
// User-supplied provider keys are forwarded only for this request; never stored or logged.
const WINDOW_MS = 60_000;
const MAX_REQUEST_BYTES = 4.2 * 1024 * 1024;
const MAX_PARTS = 80;
const hits = new Map();

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  return res.end(JSON.stringify(data));
}
function pruneRateLimitEntries(now) {
  if (hits.size <= 4000) return;
  for (const [address, item] of hits) {
    if (now - item.start >= WINDOW_MS) hits.delete(address);
    if (hits.size <= 3000) return;
  }
  // If every entry is still active, cap memory by dropping the oldest entries.
  while (hits.size > 4000) hits.delete(hits.keys().next().value);
}
function rateLimited(ip) {
  const now = Date.now(), entry = hits.get(ip);
  if (!entry || now - entry.start >= WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    pruneRateLimitEntries(now);
    return false;
  }
  entry.count += 1;
  pruneRateLimitEntries(now);
  return entry.count > 12;
}
const GEMINI_FILE_URI = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/files\/[A-Za-z0-9_-]{1,80}$/;
function validPart(part) {
  if (!part || typeof part !== "object") return false;
  if (typeof part.text === "string") return part.text.length <= 180_000;
  if (part.fileData) {
    const d = part.fileData;
    return Object.keys(part).length === 1 && Object.keys(d).every(k => k === "mimeType" || k === "fileUri") &&
      d.mimeType === "application/pdf" && typeof d.fileUri === "string" && GEMINI_FILE_URI.test(d.fileUri);
  }
  const d = part.inlineData;
  return !!d && typeof d.data === "string" && d.data.length <= 3.2 * 1024 * 1024 &&
    ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(d.mimeType);
}
function extractText(result, provider) {
  if (provider === "gemini") return (result.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  if (provider === "anthropic") return (result.content || []).filter(p => p.type === "text").map(p => p.text || "").join("");
  return result.choices?.[0]?.message?.content || "";
}
function toOpenAIContent(parts) {
  return parts.map(p => {
    if (typeof p.text === "string") return { type: "text", text: p.text };
    if (p.inlineData.mimeType === "application/pdf") throw new Error("PDF_DIRECT_UNSUPPORTED");
    return { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
  });
}
function toAnthropicContent(parts) {
  return parts.map(p => {
    if (typeof p.text === "string") return { type: "text", text: p.text };
    const d = p.inlineData;
    if (d.mimeType === "application/pdf") return { type: "document", source: { type: "base64", media_type: d.mimeType, data: d.data } };
    return { type: "image", source: { type: "base64", media_type: d.mimeType, data: d.data } };
  });
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Method not allowed" }); }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabasePublicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabasePublicKey) return json(res, 503, { error: "Configuration Supabase manquante sur le serveur." });

  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return json(res, 401, { error: "Connexion Kharait requise." });
  try {
    const base = supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl;
    const auth = await fetch(base + "/auth/v1/user", { headers: { apikey: supabasePublicKey, Authorization: authorization } });
    if (!auth.ok) return json(res, 401, { error: "Session Kharait invalide. Reconnectez-vous." });
    const user = await auth.json();
    if (!user?.id) return json(res, 401, { error: "Utilisateur non authentifié." });
  } catch { return json(res, 503, { error: "Vérification de session impossible." }); }

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) return json(res, 429, { error: "Trop de demandes. Réessayez dans une minute." });

  try {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) return json(res, 413, { error: "Fichiers trop volumineux (maximum 3 Mo)." });
    const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(raw);
    const provider = body.provider, model = body.model, parts = body.parts;
    const key = req.headers["x-kharait-provider-key"];
    if (typeof key !== "string" || key.length < 12 || key.length > 500) return json(res, 400, { error: "Clé API personnelle manquante ou invalide." });
    if (!["gemini", "groq", "openrouter", "openai", "anthropic"].includes(provider)) return json(res, 400, { error: "Fournisseur IA non pris en charge." });
    if (provider !== "gemini" && Array.isArray(parts) && parts.some(p => p && p.fileData)) return json(res, 400, { error: "Les fichiers envoyés directement ne sont pris en charge que par Gemini." });
    if (typeof model !== "string" || !/^[a-zA-Z0-9._:/-]{2,160}$/.test(model)) return json(res, 400, { error: "Identifiant de modèle invalide." });
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS || !parts.every(validPart)) return json(res, 400, { error: "Contenu invalide ou trop volumineux." });

    let url, headers, payload;
    if (provider === "gemini") {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      headers = { "Content-Type": "application/json", "x-goog-api-key": key };
      payload = { contents: [{ role: "user", parts }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } };
    } else if (provider === "anthropic") {
      if (parts.some(p => p.inlineData && !["application/pdf","image/jpeg","image/png","image/webp"].includes(p.inlineData.mimeType))) return json(res, 400, { error: "Format de média non pris en charge par Anthropic." });
      url = "https://api.anthropic.com/v1/messages";
      headers = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
      payload = { model, max_tokens: 8192, temperature: 0.2, system: "Return valid JSON only. Do not wrap the JSON in markdown fences.", messages: [{ role: "user", content: toAnthropicContent(parts) }] };
    } else {
      let content;
      try { content = toOpenAIContent(parts); }
      catch (e) { if (e.message === "PDF_DIRECT_UNSUPPORTED") return json(res, 400, { error: "Ce fournisseur ne reçoit pas les PDF directement. Pour analyser un PDF, choisissez Gemini ou Anthropic." }); throw e; }
      const bases = { groq: "https://api.groq.com/openai/v1/chat/completions", openrouter: "https://openrouter.ai/api/v1/chat/completions", openai: "https://api.openai.com/v1/chat/completions" };
      url = bases[provider];
      headers = { "Content-Type": "application/json", Authorization: "Bearer " + key };
      if (provider === "openrouter") { headers["HTTP-Referer"] = "https://kharait.vercel.app"; headers["X-Title"] = "Kharait"; }
      payload = { model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "user", content }] };
    }

    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 55_000);
    let upstream, result;
    try {
      upstream = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: controller.signal });
      result = await upstream.json().catch(() => ({}));
    } finally {
      clearTimeout(timeout);
    }
    if (!upstream.ok) {
      const message = result.error?.message || result.message || "Le fournisseur IA a refusé la demande.";
      return json(res, upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400, { error: message });
    }
    const text = extractText(result, provider);
    if (!text) return json(res, 422, { error: "Le fournisseur IA n'a renvoyé aucun contenu texte." });
    return json(res, 200, { text });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return json(res, timedOut ? 504 : 500, { error: timedOut ? "Délai dépassé. Réessayez." : "Erreur interne pendant l'appel IA." });
  }
}
