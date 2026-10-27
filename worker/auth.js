// Shared helpers for the personnel login.
// Members live in the MEMBERS secret as JSON:
//   { "username": "pbkdf2$...",                                  // hash only
//     "another":  { "hash": "pbkdf2$...", "name": "…", "role": "…" } }
// Sessions are HMAC-signed cookies keyed by SESSION_SECRET.

export const COOKIE = "doc_session";
const SESSION_HOURS = 12;
const enc = new TextEncoder();

export function getMembers(env) {
  if (!env.MEMBERS || !env.SESSION_SECRET) return null;
  try {
    const raw = JSON.parse(env.MEMBERS);
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = k.trim().toLowerCase();
      out[key] = typeof v === "string" ? { hash: v, name: k, role: "Curator" } : { name: k, role: "Curator", ...v };
    }
    return out;
  } catch {
    return null;
  }
}

/* ---------- password hashing (PBKDF2-SHA256) ---------- */

function b64ToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iter, saltB64, hashB64] = String(stored).split("$");
    if (scheme !== "pbkdf2") return false;
    const salt = b64ToBytes(saltB64);
    const expected = b64ToBytes(hashB64);
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: Number(iter) },
      key,
      expected.length * 8
    );
    return equal(new Uint8Array(bits), expected);
  } catch {
    return false;
  }
}

/* ---------- signed session tokens ---------- */

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSession(member, username, secret) {
  const payload = { u: username, n: member.name, r: member.role, exp: Date.now() + SESSION_HOURS * 3600 * 1000 };
  const body = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${bytesToB64url(sig)}`;
}

export async function readSession(request, secret) {
  const token = parseCookies(request)[COOKIE];
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64ToBytes(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64ToBytes(body)));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  const maxAge = SESSION_HOURS * 3600;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function parseCookies(request) {
  const out = {};
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function safeNext(value, fallback = "/department/") {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}

export function redirect(url, headers = {}) {
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store", ...headers } });
}
