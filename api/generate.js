// Vercel serverless function: Gemini API key stays on the server.
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
]);
const WINDOW_MS = 60_000;
const MAX_REQUEST_BYTES = 4.2 * 1024 * 1024;
const MAX_PARTS = 40;
const hits = new Map();

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(data));
}

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start >= WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 8;
}

function validPart(part) {
  if (!part || typeof part !== "object") return false;
  if (typeof part.text === "string") return part.text.length <= 180_000;
  const data = part.inlineData;
  return !!data &&
    typeof data.data === "string" &&
    data.data.length <= 3.2 * 1024 * 1024 &&
    ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(data.mimeType);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(res, 503, { error: "Le service Gemini n'est pas encore configuré sur le serveur." });

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) return json(res, 429, { error: "Trop de demandes. Réessayez dans une minute." });

  try {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
      return json(res, 413, { error: "Fichiers trop volumineux. Réduisez la taille totale." });
    }
    const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(raw);
    const { model, parts } = body;
    if (!ALLOWED_MODELS.has(model)) return json(res, 400, { error: "Modèle non autorisé." });
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS || !parts.every(validPart)) {
      return json(res, 400, { error: "Contenu envoyé invalide ou trop volumineux." });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 110_000);
    let upstream;
    try {
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
          }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
      return json(res, status, { error: result.error?.message || "Échec de l'analyse Gemini." });
    }
    const text = (result.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
    if (!text) return json(res, 422, { error: "Gemini n'a renvoyé aucun contenu exploitable." });
    return json(res, 200, { text });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return json(res, timedOut ? 504 : 500, {
      error: timedOut ? "Délai dépassé. Réessayez." : "Erreur interne pendant l'analyse.",
    });
  }
}
