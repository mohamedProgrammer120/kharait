// Legacy route disabled. All generation now uses /api/ai-generate with user-owned BYOK credentials.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(410).json({ error: "Cette route a été désactivée. Utilisez /api/ai-generate avec votre propre clé IA." });
}
