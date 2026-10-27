// Passwords, sessions and cookies.
// Members now live in the database; the MEMBERS secret is read once, on
// first run, to create the first admin accounts. Sessions are HMAC-signed
// cookies keyed by SESSION_SECRET.

export const COOKIE = "doc_session";
const SESSION_HOURS = 12;
const PBKDF2_ITERATIONS = 100000;
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

/* ---------- base64url ---------- */

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

/* ---------- password hashing (PBKDF2-SHA256) ---------- */

async function derive(password, salt, iterations, length) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, length * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const out = await derive(password, salt, PBKDF2_ITERATIONS, 32);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64url(salt)}$${bytesToB64url(out)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iter, saltB64, hashB64] = String(stored).split("$");
    if (scheme !== "pbkdf2") return false;
    const expected = b64ToBytes(hashB64);
    const out = await derive(password, b64ToBytes(saltB64), Number(iter), expected.length);
    return equal(out, expected);
  } catch {
    return false;
  }
}

/* ---------- signed session tokens ---------- */

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSession(user, secret) {
  const payload = { id: user.id, u: user.username, exp: Date.now() + SESSION_HOURS * 3600 * 1000 };
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
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
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

export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}
