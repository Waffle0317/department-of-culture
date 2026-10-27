// Admin hub: the roll of users and their clearances, and how each
// organization is compartmented.

import { json, error, hashPassword } from "./auth.js";
import { USER_COLS } from "./db.js";
import { COMPARTMENTS } from "./seed.js";

const DIVISIONS = ["public", "secret", "government"];

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}
const tier = (v) => Math.max(0, Math.min(3, Number(v) || 0));
const flag = (v) => (v === true || v === 1 || v === "1" ? 1 : 0);

// Divisions are stored as a comma-separated set, e.g. "public,secret".
// Accepts an array or a comma-separated string; unknown names are dropped.
function divisions(v) {
  const list = Array.isArray(v) ? v : String(v || "").split(",");
  const set = DIVISIONS.filter((d) => list.map((x) => String(x).trim().toLowerCase()).includes(d));
  return set.join(",");
}

export async function listUsers({ env }) {
  const users = (await env.DB.prepare(`SELECT ${USER_COLS} FROM users ORDER BY active DESC, name`).all()).results;
  return json({ users });
}

export async function createUser({ env, request }) {
  const b = await readJson(request);
  if (!b) return error("Bad request");
  const username = String(b.username || "").trim().toLowerCase();
  const name = String(b.name || "").trim();
  const password = String(b.password || "");
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) return error("Username: 2–40 letters, digits, dots, dashes or underscores");
  if (!name) return error("A display name is required");
  if (password.length < 6) return error("Password must be at least 6 characters");
  const exists = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (exists) return error("That username is already on the roll");
  const role = b.role === "admin" ? "admin" : "member";
  const division = divisions(b.division);
  if (!division) return error("Pick at least one division");
  const res = await env.DB.prepare(`
    INSERT INTO users (username, name, role, division, tier_public, tier_secret, tier_government, tier4, pass_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(username, name, role, division, tier(b.tier_public), tier(b.tier_secret), tier(b.tier_government), flag(b.tier4), await hashPassword(password))
    .run();
  return json({ id: res.meta.last_row_id }, 201);
}

export async function updateUser({ env, user, request, params }) {
  const id = params[0];
  const target = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first();
  if (!target) return error("No such user", 404);
  const b = await readJson(request);
  if (!b) return error("Bad request");

  const name = b.name !== undefined ? String(b.name).trim() : target.name;
  if (!name) return error("A display name is required");
  const role = b.role !== undefined ? (b.role === "admin" ? "admin" : "member") : target.role;
  const division = b.division !== undefined ? divisions(b.division) : target.division;
  if (!division) return error("Pick at least one division");
  const active = b.active !== undefined ? flag(b.active) : target.active;
  const t = {
    tier_public: b.tier_public !== undefined ? tier(b.tier_public) : target.tier_public,
    tier_secret: b.tier_secret !== undefined ? tier(b.tier_secret) : target.tier_secret,
    tier_government: b.tier_government !== undefined ? tier(b.tier_government) : target.tier_government,
    tier4: b.tier4 !== undefined ? flag(b.tier4) : target.tier4,
  };
  if (id === user.id && (role !== "admin" || !active)) return error("You cannot remove your own admin access or deactivate yourself");
  if (role !== "admin" || !active) {
    const admins = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").bind(id).first()).n;
    if (admins === 0) return error("There must always be one active admin");
  }

  await env.DB.prepare(`
    UPDATE users SET name = ?, role = ?, division = ?, active = ?, tier_public = ?, tier_secret = ?, tier_government = ?, tier4 = ?
    WHERE id = ?`)
    .bind(name, role, division, active, t.tier_public, t.tier_secret, t.tier_government, t.tier4, id).run();

  if (b.password) {
    if (String(b.password).length < 6) return error("Password must be at least 6 characters");
    await env.DB.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").bind(await hashPassword(String(b.password)), id).run();
  }
  const updated = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first();
  return json({ user: updated });
}

export async function listOrgs({ env }) {
  const orgs = (await env.DB.prepare(`
    SELECT o.id, o.slug, o.name, o.long_name, o.compartment, o.min_tier, o.sort,
           (SELECT COUNT(*) FROM people p WHERE p.org_id = o.id) AS people
    FROM organizations o ORDER BY o.sort`).all()).results;
  return json({ orgs });
}

export async function updateOrg({ env, request, params }) {
  const id = params[0];
  const o = await env.DB.prepare("SELECT id, compartment, min_tier, name, long_name FROM organizations WHERE id = ?").bind(id).first();
  if (!o) return error("No such organization", 404);
  const b = await readJson(request);
  if (!b) return error("Bad request");
  const compartment = b.compartment !== undefined ? b.compartment : o.compartment;
  if (!COMPARTMENTS.includes(compartment)) return error("Compartment must be public, secret or government");
  const min_tier = b.min_tier !== undefined ? Math.max(1, Math.min(4, Number(b.min_tier) || 1)) : o.min_tier;
  const name = b.name !== undefined ? String(b.name).trim() || o.name : o.name;
  const long_name = b.long_name !== undefined ? String(b.long_name).trim() || null : o.long_name;
  await env.DB.prepare("UPDATE organizations SET compartment = ?, min_tier = ?, name = ?, long_name = ? WHERE id = ?")
    .bind(compartment, min_tier, name, long_name, id).run();
  return json({ ok: true });
}
