// Admin hub: the roll of users and their clearances, and how each
// organization is compartmented. Adding a Curator to the roll also opens
// their personnel record on the Party tab; later edits keep it in step.

import { json, error, hashPassword } from "./auth.js";
import { USER_COLS } from "./db.js";
import { COMPARTMENTS, DEPT_RANKS } from "./seed.js";

const DIVISIONS = ["public", "secret", "government"];
const DIVISION_ORDER = ["government", "secret", "public"]; // Abt. I, II, III as the hub lists them
const rankOf = (v) => (DEPT_RANKS.includes(v) ? v : null);

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

// The first division ticked, in the order the hub shows them (Abt. I, II, III).
function firstDivision(csv) {
  const set = String(csv || "").split(",");
  return DIVISION_ORDER.find((d) => set.includes(d)) || null;
}

/* ---------- the personnel record behind a user ---------- */

async function partyRank(env, partyId, rank) {
  if (!rank) return null;
  const r = await env.DB.prepare("SELECT id, tier FROM ranks WHERE org_id = ? AND name = ?").bind(partyId, rank).first();
  return r || null;
}

async function openRecord(env, user, adminId) {
  const party = await env.DB.prepare("SELECT id FROM organizations WHERE slug = 'party'").first();
  if (!party) return null;
  const r = await partyRank(env, party.id, user.rank);
  const res = await env.DB.prepare(`
    INSERT INTO people (org_id, rank_id, name, status, tier, division, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(party.id, r ? r.id : null, user.name, user.active ? "serving" : "retired", r ? r.tier : 1, firstDivision(user.division), adminId)
    .run();
  const id = res.meta.last_row_id;
  await env.DB.prepare("UPDATE users SET person_id = ? WHERE id = ?").bind(id, user.id).run();
  return id;
}

async function syncRecord(env, user) {
  if (!user.person_id) return;
  const p = await env.DB.prepare("SELECT p.id, p.status, o.slug FROM people p JOIN organizations o ON o.id = p.org_id WHERE p.id = ?").bind(user.person_id).first();
  if (!p || p.slug !== "party") return; // record removed or moved; leave it alone
  const party = await env.DB.prepare("SELECT id FROM organizations WHERE slug = 'party'").first();
  const r = await partyRank(env, party.id, user.rank);
  // Keep a status the Director set by hand (leave, probation); only flip serving/retired with active.
  const status = !user.active ? "retired" : (p.status === "retired" ? "serving" : p.status);
  await env.DB.prepare(`
    UPDATE people SET name = ?, rank_id = ?, tier = ?, division = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(user.name, r ? r.id : null, r ? r.tier : 1, firstDivision(user.division), status, p.id).run();
}

/* ---------- users ---------- */

export async function listUsers({ env }) {
  const users = (await env.DB.prepare(`SELECT ${USER_COLS} FROM users ORDER BY active DESC, name`).all()).results;
  return json({ users });
}

export async function createUser({ env, user: admin, request }) {
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
  // The password set here is temporary: the Curator must choose their own at first sign-in.
  const res = await env.DB.prepare(`
    INSERT INTO users (username, name, role, rank, division, tier_public, tier_secret, tier_government, tier4, pass_hash, must_change)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .bind(username, name, role, rankOf(b.rank), division, tier(b.tier_public), tier(b.tier_secret), tier(b.tier_government), flag(b.tier4), await hashPassword(password))
    .run();
  const id = res.meta.last_row_id;
  const created = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first();
  const personId = await openRecord(env, created, admin.id);
  return json({ id, person_id: personId }, 201);
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

  const rank = b.rank !== undefined ? rankOf(b.rank) : target.rank;
  await env.DB.prepare(`
    UPDATE users SET name = ?, role = ?, rank = ?, division = ?, active = ?, tier_public = ?, tier_secret = ?, tier_government = ?, tier4 = ?
    WHERE id = ?`)
    .bind(name, role, rank, division, active, t.tier_public, t.tier_secret, t.tier_government, t.tier4, id).run();

  if (b.password) {
    if (String(b.password).length < 6) return error("Password must be at least 6 characters");
    // A reset by an admin is temporary too, unless they are resetting their own.
    await env.DB.prepare("UPDATE users SET pass_hash = ?, must_change = ? WHERE id = ?")
      .bind(await hashPassword(String(b.password)), id === user.id ? 0 : 1, id).run();
  }
  const updated = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first();
  if (updated.person_id) await syncRecord(env, updated);
  else if (b.open_record) await openRecord(env, updated, user.id);
  return json({ user: await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first() });
}

// Remove an account for good. The personnel record the hub opened for them
// goes too; reports and files they wrote stay, with the author cleared.
export async function deleteUser({ env, user, params }) {
  const id = params[0];
  const target = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first();
  if (!target) return error("No such user", 404);
  if (id === user.id) return error("You cannot delete your own account");
  if (target.role === "admin" && target.active) {
    const admins = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").bind(id).first()).n;
    if (admins === 0) return error("There must always be one active admin");
  }
  const stmts = [
    env.DB.prepare("UPDATE reports SET author_id = NULL WHERE author_id = ?").bind(id),
    env.DB.prepare("UPDATE people SET created_by = NULL WHERE created_by = ?").bind(id),
    env.DB.prepare("UPDATE notes SET restricted_by = NULL WHERE restricted_by = ?").bind(id),
  ];
  if (target.person_id) {
    const p = await env.DB.prepare("SELECT p.id FROM people p JOIN organizations o ON o.id = p.org_id WHERE p.id = ? AND o.slug = 'party'").bind(target.person_id).first();
    if (p) {
      stmts.push(env.DB.prepare("DELETE FROM reports WHERE person_id = ?").bind(p.id));
      stmts.push(env.DB.prepare("UPDATE people SET reports_to = NULL WHERE reports_to = ?").bind(p.id));
      stmts.push(env.DB.prepare("DELETE FROM people WHERE id = ?").bind(p.id));
    }
  }
  stmts.push(env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

/* ---------- organizations ---------- */

export async function listOrgs({ env }) {
  const orgs = (await env.DB.prepare(`
    SELECT o.id, o.slug, o.name, o.long_name, o.compartment, o.min_tier, o.sort, o.access,
           (SELECT COUNT(*) FROM people p WHERE p.org_id = o.id) AS people
    FROM organizations o ORDER BY o.sort`).all()).results;
  return json({ orgs });
}

export async function updateOrg({ env, request, params }) {
  const id = params[0];
  const o = await env.DB.prepare("SELECT id, compartment, min_tier, name, long_name, access FROM organizations WHERE id = ?").bind(id).first();
  if (!o) return error("No such organization", 404);
  const b = await readJson(request);
  if (!b) return error("Bad request");
  const compartment = b.compartment !== undefined ? b.compartment : o.compartment;
  if (!COMPARTMENTS.includes(compartment)) return error("Compartment must be public, secret or government");
  const min_tier = b.min_tier !== undefined ? Math.max(1, Math.min(4, Number(b.min_tier) || 1)) : o.min_tier;
  const access = b.access !== undefined ? (b.access === "open" ? "open" : "tiered") : o.access;
  const name = b.name !== undefined ? String(b.name).trim() || o.name : o.name;
  const long_name = b.long_name !== undefined ? String(b.long_name).trim() || null : o.long_name;
  await env.DB.prepare("UPDATE organizations SET compartment = ?, min_tier = ?, access = ?, name = ?, long_name = ? WHERE id = ?")
    .bind(compartment, min_tier, access, name, long_name, id).run();
  return json({ ok: true });
}
