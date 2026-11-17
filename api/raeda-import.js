// Import des séances depuis la plateforme Raeda (https://raeda.alistic.net/).
// Deux actions, réservées aux utilisateurs connectés à Kharait :
//   GET /api/raeda-import?action=list&sem=sem4&seance=1&subject=all  → liste des cours (JSON)
//   GET /api/raeda-import?action=file&course=ne-ar-n1-p2-sem4-s1      → fichier PPTX (binaire)
// Le serveur ne contacte que l'hôte Raeda ci-dessous, avec des paramètres validés strictement,
// et ne télécharge qu'un fichier à la fois, à la demande de l'utilisateur (pas d'exploration en masse).
import JSZip from "jszip";
import { authenticate, json } from "./_lib/credentials.js";

const RAEDA_ORIGIN = "https://raeda.alistic.net";
const MAX_FILE_BYTES = 4.2 * 1024 * 1024; // limite des réponses des fonctions Vercel (~4,5 Mo)
const SLIM_TARGET_BYTES = 3.9 * 1024 * 1024; // taille visée après allègement
const MAX_SOURCE_BYTES = 40 * 1024 * 1024; // taille maximale acceptée depuis Raeda avant allègement
const DOWNLOAD_TIMEOUT_MS = Number(process.env.RAEDA_DOWNLOAD_TIMEOUT_MS) || 50_000; // doit rester sous maxDuration (60 s) dans vercel.json
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

const TOO_LARGE = "Fichier trop volumineux pour l'import automatique (max. 40 Mo). Téléchargez-le puis ajoutez-le manuellement.";
const CANNOT_SLIM = "Même sans ses grosses images, ce fichier dépasse la limite de ~4 Mo. Téléchargez-le puis ajoutez-le manuellement.";

// La limite de ~4,5 Mo des réponses Vercel empêche de renvoyer un gros PPTX tel quel. Kharait n'a besoin
// que du texte (et de quelques petites images) : on retire donc les vidéos, objets intégrés et les plus
// grosses images jusqu'à passer sous la limite. Le fichier renvoyé n'est lu que par Kharait.
async function slimPptx(buffer) {
  if (buffer.length <= MAX_FILE_BYTES) return { buffer, slimmed: false };
  const zip = await JSZip.loadAsync(buffer);
  const images = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (/^ppt\/media\/.+\.(png|jpe?g|webp)$/i.test(name)) images.push({ name, size: (await entry.async("uint8array")).length });
    else if (/^ppt\/(media|embeddings)\//i.test(name) || /^docProps\/thumbnail/i.test(name)) zip.remove(name);
  }
  images.sort((a, b) => b.size - a.size); // du plus gros au plus petit
  const generate = () => zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  let out = await generate();
  while (out.length > SLIM_TARGET_BYTES && images.length) {
    const drop = images.splice(0, Math.max(1, Math.ceil(images.length / 3)));
    drop.forEach(img => zip.remove(img.name));
    out = await generate();
  }
  if (out.length > MAX_FILE_BYTES) return { error: CANNOT_SLIM, status: 413 };
  return { buffer: out, slimmed: true };
}

// Téléchargement en flux : on s'arrête dès que la taille limite est dépassée, et en cas de délai
// dépassé le message précise si Raeda n'a rien répondu ou si le transfert était juste trop lent.
async function downloadPptx(course) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const started = Date.now();
  let phase = "headers", received = 0, tooLarge = false;
  try {
    const response = await fetch(`${RAEDA_ORIGIN}/download.php?course=${encodeURIComponent(course)}`, {
      headers: { "User-Agent": "Kharait-importer/1.0 (+https://kharait.vercel.app)", Accept: "*/*", Referer: RAEDA_ORIGIN + "/slides.php" },
      signal: controller.signal
    });
    if (new URL(response.url).origin !== RAEDA_ORIGIN) return { status: 502, error: "Redirection inattendue depuis Raeda." };
    if (!response.ok) return { status: 502, error: `Raeda a répondu ${response.status}.` };
    phase = "body";
    if (Number(response.headers.get("content-length") || 0) > MAX_SOURCE_BYTES) { controller.abort(); return { status: 413, error: TOO_LARGE }; }
    const chunks = [];
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > MAX_SOURCE_BYTES) { tooLarge = true; break; }
      chunks.push(chunk);
    }
    if (tooLarge) return { status: 413, error: TOO_LARGE };
    return { buffer: Buffer.concat(chunks) };
  } catch (e) {
    if (tooLarge) return { status: 413, error: TOO_LARGE };
    if (controller.signal.aborted) {
      const secs = Math.round((Date.now() - started) / 1000);
      const detail = phase === "headers" ? "aucune réponse reçue" : `${Math.round(received / 1024)} Ko reçus seulement`;
      return { status: 504, error: `Raeda n'a pas répondu à temps (${detail} en ${secs} s).` };
    }
    return { status: 502, error: "Impossible de joindre Raeda." };
  } finally {
    clearTimeout(timer);
  }
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
      const result = await downloadPptx(course);
      if (result.error) return json(res, result.status, { error: result.error });
      if (result.buffer.length < 4 || result.buffer[0] !== 0x50 || result.buffer[1] !== 0x4b) return json(res, 502, { error: "Raeda n'a pas renvoyé un fichier PPTX valide." });
      const slim = await slimPptx(result.buffer);
      if (slim.error) return json(res, slim.status, { error: slim.error });
      const buffer = slim.buffer;
      if (slim.slimmed) res.setHeader("X-Kharait-Slimmed", "1");
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
