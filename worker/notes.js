// Box 70: reports from the public, and The People's Notes where the
// Department reads them. Anyone may drop a note. Every signed-in member
// may read an unrestricted note. Tier 3 in any compartment may delete.
// Tier 4 may restrict a note, which hides it from everyone below Tier 4.

import { json, error, redirect } from "./auth.js";
import { maxTier } from "./db.js";

const MAX_BODY = 6000;
const MAX_FIELD = 300;
const RATE_WINDOW_MIN = 10;
const RATE_LIMIT = 5;

const s = (v, max = MAX_FIELD) => {
  if (v === undefined || v === null) return null;
  const t = String(v).replace(/\r\n/g, "\n").trim();
  return t ? t.slice(0, max) : null;
};

async function hashIp(request) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "local";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("box70:" + ip)));
  return [...bytes.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- public: drop a note ---------- */

export async function submit({ request, env }) {
  const form = await request.formData();
  // A field people never see; anything in it is a machine.
  if (String(form.get("website") || "").trim()) return redirect("/box-70/?sent=1");

  const body = s(form.get("body"), MAX_BODY);
  if (!body || body.length < 10) return redirect("/box-70/?error=short");

  const ip_hash = await hashIp(request);
  const recent = (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notes WHERE ip_hash = ? AND created_at > datetime('now', ?)"
  ).bind(ip_hash, `-${RATE_WINDOW_MIN} minutes`).first()).n;
  if (recent >= RATE_LIMIT) return redirect("/box-70/?error=rate");

  await env.DB.prepare(`
    INSERT INTO notes (body, subject, when_text, where_text, witnesses, reporter_name, reporter_contact, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(body, s(form.get("subject")), s(form.get("when")), s(form.get("where")), s(form.get("witnesses")),
      s(form.get("name")), s(form.get("contact")), ip_hash)
    .run();
  return redirect("/box-70/?sent=1");
}

/* ---------- internal: The People's Notes ---------- */

function shape(n, user) {
  const t = maxTier(user);
  if (n.restricted && t < 4) {
    return { id: n.id, restricted: 1, created_at: n.created_at };
  }
  const { ip_hash, ...rest } = n;
  return rest;
}

export async function list({ env, user }) {
  const rows = (await env.DB.prepare(`
    SELECT n.id, n.body, n.subject, n.when_text, n.where_text, n.witnesses, n.reporter_name, n.reporter_contact,
           n.restricted, n.restricted_at, n.created_at, u.name AS restricted_by_name
    FROM notes n LEFT JOIN users u ON u.id = n.restricted_by
    ORDER BY n.created_at DESC, n.id DESC LIMIT 500`).all()).results;
  const t = maxTier(user);
  return json({ notes: rows.map((n) => shape(n, user)), can: { delete: t >= 3, restrict: t >= 4 }, tier: t });
}

export async function restrict({ env, user, params }) {
  if (maxTier(user) < 4) return error("Tier 4 only", 403);
  const n = await env.DB.prepare("SELECT id FROM notes WHERE id = ?").bind(params[0]).first();
  if (!n) return error("No such note", 404);
  await env.DB.prepare("UPDATE notes SET restricted = 1, restricted_by = ?, restricted_at = datetime('now') WHERE id = ?")
    .bind(user.id, n.id).run();
  return json({ ok: true });
}

export async function unrestrict({ env, user, params }) {
  if (maxTier(user) < 4) return error("Tier 4 only", 403);
  await env.DB.prepare("UPDATE notes SET restricted = 0, restricted_by = NULL, restricted_at = NULL WHERE id = ?")
    .bind(params[0]).run();
  return json({ ok: true });
}

export async function remove({ env, user, params }) {
  const t = maxTier(user);
  if (t < 3) return error("Tier 3 or above only", 403);
  const n = await env.DB.prepare("SELECT id, restricted FROM notes WHERE id = ?").bind(params[0]).first();
  if (!n) return error("No such note", 404);
  if (n.restricted && t < 4) return error("This note is restricted", 403);
  await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(n.id).run();
  return json({ ok: true });
}
