// Import des séances depuis la plateforme Raeda (https://raeda.alistic.net/).
// Deux actions, réservées aux utilisateurs connectés à Kharait :
//   GET /api/raeda-import?action=list&sem=sem4&seance=1&subject=all  → liste des cours (JSON)
//   GET /api/raeda-import?action=file&course=ne-ar-n1-p2-sem4-s1      → fichier PPTX (binaire)
// Le serveur ne contacte que l'hôte Raeda ci-dessous, avec des paramètres validés strictement,
// et ne télécharge qu'un fichier à la fois, à la demande de l'utilisateur (pas d'exploration en masse).
import { authenticate, json } from "./_lib/credentials.js";

const RAEDA_ORIGIN = "https://raeda.alistic.net";
const MAX_FILE_BYTES = 4.2 * 1024 * 1024; // limite des réponses des fonctions Vercel (~4,5 Mo)
const WINDOW_MS = 60_000;
const MAX_CALLS = 40;
const SUBJECTS = new Set(["all", "ar", "fr", "math", "sci"]);
const SUBJECT_CODES = { ar: "ar", fr: "fr", math: "math", es: "sci" };
const hits = new Map();

function rateLimited(userId) {
  const now = Date.now(), entry = hits.get(userId);
  if (!entry || now - entry.start >= WINDOW_MS) {
    hits.set(userId, { start: now, count: 1 });
    if (hits.size > 2000) for (const [k, v] of hits) if (now - v.start >= WINDOW_MS) hits.delete(k);
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_CALLS;
}

async function raedaFetch(path) {
  const response = await fetch(RAEDA_ORIGIN + path, {
    headers: { "User-Agent": "Kharait-importer/1.0 (+https://kharait.vercel.app)", Accept: "*/*" },
    signal: AbortSignal.timeout(25_000)
  });
  if (new URL(response.url).origin !== RAEDA_ORIGIN) throw new Error("REDIRECT_OFF_HOST");
  return response;
}

function parseCourse(code) {
  const m = code.match(/^ne-([a-z]+)-n(\d(?:-\d)?)-p(\d+)-sem(\d+)-s(\d+)$/);
  if (!m) return { code, subject: "", level: "", phase: "", sem: "", seance: "" };
  return { code, subject: SUBJECT_CODES[m[1]] || m[1], level: "n" + m[2], phase: m[3], sem: m[4], seance: m[5] };
}

function extractCourseCodes(html) {
  const text = html.replace(/&amp;/g, "&");
  const codes = new Set();
  for (const m of text.matchAll(/download\.php\?course=([a-z0-9-]{3,60})/gi)) codes.add(m[1].toLowerCase());
  return [...codes];
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return json(res, 405, { error: "Method not allowed" }); }

  let user;
  try {
    user = await authenticate(req);
    if (!user) return json(res, 401, { error: "Session Kharait invalide. Reconnectez-vous." });
  } catch { return json(res, 503, { error: "Vérification de session impossible." }); }
  if (rateLimited(user.id)) return json(res, 429, { error: "Trop de demandes. Réessayez dans une minute." });

  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  try {
    if (q.action === "list") {
      const sem = String(q.sem || "all"), seance = String(q.seance || "all"), subject = String(q.subject || "all");
      if (!(sem === "all" || /^sem[1-9]$/.test(sem)) || !(seance === "all" || /^[1-9]$/.test(seance)) || !SUBJECTS.has(subject)) return json(res, 400, { error: "Paramètres invalides." });
      const params = new URLSearchParams({ subject, view: "table" });
      if (sem !== "all") params.set("sem", sem);
      if (seance !== "all") params.set("seance", seance);
      const page = await raedaFetch(`/slides.php?${params}`);
      if (!page.ok) return json(res, 502, { error: `Raeda a répondu ${page.status}.` });
      // Raeda renvoie parfois tout le catalogue quel que soit le filtre demandé : on filtre donc nous-mêmes.
      const courses = extractCourseCodes(await page.text()).map(parseCourse).filter(c =>
        (subject === "all" || c.subject === subject) &&
        (sem === "all" || c.sem === sem.slice(3)) &&
        (seance === "all" || c.seance === seance)
      ).sort((a, b) => (Number(a.sem) - Number(b.sem)) || (Number(a.phase) - Number(b.phase)) || (Number(a.seance) - Number(b.seance)) || a.subject.localeCompare(b.subject) || a.level.localeCompare(b.level));
      return json(res, 200, { courses });
    }

    if (q.action === "file") {
      const course = String(q.course || "").toLowerCase();
      if (!/^[a-z0-9-]{3,60}$/.test(course)) return json(res, 400, { error: "Code de cours invalide." });
      const file = await raedaFetch(`/download.php?course=${encodeURIComponent(course)}`);
      if (!file.ok) return json(res, 502, { error: `Raeda a répondu ${file.status}.` });
      const declared = Number(file.headers.get("content-length") || 0);
      if (declared > MAX_FILE_BYTES) return json(res, 413, { error: "Fichier trop volumineux pour l'import automatique (max. ~4 Mo). Téléchargez-le puis ajoutez-le manuellement." });
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > MAX_FILE_BYTES) return json(res, 413, { error: "Fichier trop volumineux pour l'import automatique (max. ~4 Mo). Téléchargez-le puis ajoutez-le manuellement." });
      if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return json(res, 502, { error: "Raeda n'a pas renvoyé un fichier PPTX valide." });
      res.status(200);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Content-Length", String(buffer.length));
      return res.end(buffer);
    }

    return json(res, 400, { error: "Action inconnue." });
  } catch (e) {
    if (e && e.name === "TimeoutError") return json(res, 504, { error: "Raeda met trop de temps à répondre." });
    return json(res, 502, { error: "Impossible de joindre Raeda." });
  }
}
