import crypto from "node:crypto";

function masterKey() {
  const key = Buffer.from(process.env.KHARAIT_CREDENTIALS_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_NOT_CONFIGURED");
  return key;
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    key_ciphertext: data.toString("base64"),
    key_iv: iv.toString("base64"),
    key_tag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptSecret(row) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(row.key_iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.key_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.key_ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.end(JSON.stringify(data));
}

export async function authenticate(req) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  const authorization = req.headers.authorization || "";
  if (!base || !pub || !authorization.startsWith("Bearer ")) return null;
  const response = await fetch(base + "/auth/v1/user", {
    headers: { apikey: pub, Authorization: authorization }
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user && user.id ? { id: user.id, base, pub, authorization } : null;
}
