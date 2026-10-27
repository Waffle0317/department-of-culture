// The Collection: people, their files, reports and chart positions.
// Every read applies the clearance rule; every write is recorded with the
// Curator's id. Anyone may file a person or a report; who can read it is
// decided by tier and compartment.

import { json, error } from "./auth.js";
import { isAdmin, userTier } from "./db.js";

const STATUSES = ["watched", "referred", "closed", "cleared"];
const MAX_PORTRAIT = 400_000; // characters of data URL (~300 KB image)

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function s(v, max = 2000) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

function portraitOk(p) {
  if (p === null || p === undefined || p === "") return true;
  return typeof p === "string" && p.length <= MAX_PORTRAIT && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p);
}

async function orgById(env, id) {
  return env.DB.prepare("SELECT id, slug, name, long_name, compartment, min_tier FROM organizations WHERE id = ?").bind(id).first();
}

// Load a person with their organization, and check the caller may see them.
async function visiblePerson(env, user, id) {
  const p = await env.DB.prepare(`
    SELECT p.*, o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, r.name AS rank_name, r.band AS rank_band
    FROM people p JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.id = ?`).bind(id).first();
  if (!p) return null;
  const t = userTier(user, p.compartment);
  if (t < p.tier || t < p.min_tier) return null;
  return p;
}

// Tier a person is filed at: the rank's band sets the floor; the author may raise it.
async function computeTier(env, rank_id, requested) {
  let floor = 1;
  if (rank_id) {
    const r = await env.DB.prepare("SELECT tier FROM ranks WHERE id = ?").bind(rank_id).first();
    if (r) floor = r.tier;
  }
  const req = Number(requested) || 0;
  return Math.min(4, Math.max(floor, req));
}

/* ---------- organizations ---------- */

export async function listOrgs({ env, user }) {
  const orgs = (await env.DB.prepare("SELECT id, slug, name, long_name, compartment, min_tier, sort FROM organizations ORDER BY sort").all()).results;
  const ranks = (await env.DB.prepare("SELECT id, org_id, name, band, tier, sort FROM ranks ORDER BY org_id, sort").all()).results;
  const visible = orgs.filter((o) => userTier(user, o.compartment) >= o.min_tier);
  for (const o of visible) {
    o.tier = userTier(user, o.compartment);
    o.ranks = ranks.filter((r) => r.org_id === o.id).map(({ id, name, band, tier }) => ({ id, name, band, tier }));
  }
  // Every org (without ranks) so forms can file people anywhere, even where the author cannot read.
  const all = orgs.map(({ id, slug, name, compartment, min_tier }) => ({ id, slug, name, compartment, min_tier,
    ranks: ranks.filter((r) => r.org_id === id).map(({ id, name, band, tier }) => ({ id, name, band, tier })) }));
  return json({ orgs: visible, all });
}

/* ---------- people ---------- */

export async function listPeople({ env, user, url }) {
  const slug = url.searchParams.get("org");
  const org = await env.DB.prepare("SELECT id, slug, name, compartment, min_tier FROM organizations WHERE slug = ?").bind(slug).first();
  if (!org) return error("Unknown organization", 404);
  const t = userTier(user, org.compartment);
  if (t < org.min_tier) return error("Clearance insufficient", 403);

  // Everyone in the organization. People above the caller's clearance come
  // back as redacted stubs: the chart still shows that someone is there.
  const rows = (await env.DB.prepare(`
    SELECT p.id, p.name, p.title, p.rank_text, p.party_member, p.status, p.tier, p.reports_to, p.x, p.y,
           p.updated_at, r.name AS rank_name, r.band AS rank_band, r.sort AS rank_sort,
           CASE WHEN p.portrait IS NULL THEN 0 ELSE 1 END AS has_portrait,
           (SELECT COUNT(*) FROM reports rp WHERE rp.person_id = p.id AND rp.tier <= ?) AS report_count
    FROM people p LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.org_id = ?
    ORDER BY COALESCE(r.sort, 999), p.name`).bind(t, org.id).all()).results;
  const people = rows.map((p) => (p.tier <= t ? p : redacted(p)));

  // Superiors who sit in another organization; redacted when out of clearance.
  const ids = new Set(people.map((p) => p.id));
  const extIds = [...new Set(people.map((p) => p.reports_to).filter((id) => id && !ids.has(id)))];
  let externals = [];
  if (extIds.length) {
    const ext = (await env.DB.prepare(`
      SELECT p.id, p.name, p.tier, p.title, o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, r.name AS rank_name
      FROM people p JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id
      WHERE p.id IN (${extIds.map(() => "?").join(",")})`).bind(...extIds).all()).results;
    externals = ext.map((e) => (userTier(user, e.compartment) >= Math.max(e.tier, e.min_tier)
      ? { id: e.id, name: e.name, title: e.title, org_slug: e.org_slug, org_name: e.org_name, rank_name: e.rank_name }
      : { id: e.id, name: e.name, redacted: 1, tier: Math.max(e.tier, e.min_tier) }));
  }
  return json({ org: { ...org, tier: t }, people, externals });
}

// What a Curator without clearance is told about a person: the name, and
// that a file exists. Nothing else.
function redacted(p) {
  return { id: p.id, name: p.name, redacted: 1, tier: p.tier, reports_to: p.reports_to, x: p.x, y: p.y };
}

export async function getPerson({ env, user, params }) {
  const p = await visiblePerson(env, user, params[0]);
  if (!p) return error("No such file, or clearance insufficient", 404);
  const t = userTier(user, p.compartment);
  const reports = (await env.DB.prepare(`
    SELECT rp.id, rp.tier, rp.body, rp.created_at, rp.author_id, u.name AS author_name
    FROM reports rp LEFT JOIN users u ON u.id = rp.author_id
    WHERE rp.person_id = ? AND rp.tier <= ? ORDER BY rp.created_at DESC, rp.id DESC`).bind(p.id, t).all()).results;
  const withheld = (await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE person_id = ? AND tier > ?").bind(p.id, t).first()).n;
  const superior = p.reports_to ? await stub(env, user, p.reports_to) : null;
  const subs = (await env.DB.prepare(`
    SELECT p.id, p.name, p.title, p.tier, o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, r.name AS rank_name
    FROM people p JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.reports_to = ? ORDER BY p.name`).bind(p.id).all()).results.map((e) => stubOf(user, e));
  const creator = p.created_by ? await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(p.created_by).first() : null;
  return json({
    person: { ...p, created_by_name: creator ? creator.name : null },
    reports, withheld, superior, subordinates: subs,
    can: { edit: true, delete: isAdmin(user), admin: isAdmin(user), me: user.id },
  });
}

// A short reference to another person: their name if the caller may see
// them, otherwise a redacted marker.
function stubOf(user, e) {
  if (userTier(user, e.compartment) >= Math.max(e.tier, e.min_tier)) {
    const { id, name, title, org_slug, org_name, rank_name } = e;
    return { id, name, title, org_slug, org_name, rank_name };
  }
  return { id: e.id, name: e.name, redacted: 1, tier: Math.max(e.tier, e.min_tier) };
}

async function stub(env, user, id) {
  const e = await env.DB.prepare(`
    SELECT p.id, p.name, p.title, p.tier, o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, r.name AS rank_name
    FROM people p JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id WHERE p.id = ?`).bind(id).first();
  return e ? stubOf(user, e) : null;
}

async function validatePersonBody(env, body) {
  const name = s(body.name, 120);
  if (!name) return { err: "A name is required" };
  const org = await orgById(env, Number(body.org_id));
  if (!org) return { err: "Choose an organization" };
  let rank_id = body.rank_id ? Number(body.rank_id) : null;
  if (rank_id) {
    const r = await env.DB.prepare("SELECT id FROM ranks WHERE id = ? AND org_id = ?").bind(rank_id, org.id).first();
    if (!r) return { err: "That rank does not belong to that organization" };
  }
  const status = STATUSES.includes(body.status) ? body.status : "watched";
  let party_member = null;
  if (body.party_member === 1 || body.party_member === "1" || body.party_member === true) party_member = 1;
  if (body.party_member === 0 || body.party_member === "0" || body.party_member === false) party_member = 0;
  let reports_to = body.reports_to ? Number(body.reports_to) : null;
  if (reports_to) {
    const sup = await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(reports_to).first();
    if (!sup) return { err: "Superior not found" };
  }
  if (!portraitOk(body.portrait)) return { err: "Portrait must be a JPEG, PNG or WebP under 300 KB" };
  const tier = await computeTier(env, rank_id, body.tier);
  return {
    ok: {
      name, org_id: org.id, rank_id, rank_text: s(body.rank_text, 120), title: s(body.title, 160),
      party_member, status, info: s(body.info, 20000), reports_to, tier,
      portrait: body.portrait === undefined ? undefined : (body.portrait || null),
    },
  };
}

export async function createPerson({ env, user, request }) {
  const body = await readJson(request);
  if (!body) return error("Bad request");
  const v = await validatePersonBody(env, body);
  if (v.err) return error(v.err);
  const d = v.ok;
  const res = await env.DB.prepare(`
    INSERT INTO people (org_id, rank_id, rank_text, title, name, party_member, status, tier, info, portrait, reports_to, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(d.org_id, d.rank_id, d.rank_text, d.title, d.name, d.party_member, d.status, d.tier, d.info, d.portrait || null, d.reports_to, user.id)
    .run();
  const id = res.meta.last_row_id;
  const visible = !!(await visiblePerson(env, user, id));
  return json({ id, visible }, 201);
}

export async function updatePerson({ env, user, request, params }) {
  const p = await visiblePerson(env, user, params[0]);
  if (!p) return error("No such file, or clearance insufficient", 404);
  const body = await readJson(request);
  if (!body) return error("Bad request");
  if (Number(body.reports_to) === p.id) return error("A person cannot report to themselves");
  const v = await validatePersonBody(env, body);
  if (v.err) return error(v.err);
  const d = v.ok;
  const portrait = d.portrait === undefined ? p.portrait : d.portrait;
  await env.DB.prepare(`
    UPDATE people SET org_id = ?, rank_id = ?, rank_text = ?, title = ?, name = ?, party_member = ?, status = ?, tier = ?,
      info = ?, portrait = ?, reports_to = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(d.org_id, d.rank_id, d.rank_text, d.title, d.name, d.party_member, d.status, d.tier, d.info, portrait, d.reports_to, p.id)
    .run();
  const visible = !!(await visiblePerson(env, user, p.id));
  return json({ id: p.id, visible });
}

export async function deletePerson({ env, params }) {
  await env.DB.prepare("DELETE FROM reports WHERE person_id = ?").bind(params[0]).run();
  await env.DB.prepare("UPDATE people SET reports_to = NULL WHERE reports_to = ?").bind(params[0]).run();
  await env.DB.prepare("DELETE FROM people WHERE id = ?").bind(params[0]).run();
  return json({ ok: true });
}

export async function setPosition({ env, user, request, params }) {
  const p = await visiblePerson(env, user, params[0]);
  if (!p) return error("No such file, or clearance insufficient", 404);
  const body = await readJson(request);
  if (!body) return error("Bad request");
  const x = body.x === null ? null : Number(body.x);
  const y = body.y === null ? null : Number(body.y);
  if ((x !== null && !Number.isFinite(x)) || (y !== null && !Number.isFinite(y))) return error("Bad position");
  await env.DB.prepare("UPDATE people SET x = ?, y = ? WHERE id = ?").bind(x, y, p.id).run();
  return json({ ok: true });
}

export async function search({ env, user, url }) {
  const q = s(url.searchParams.get("q"), 80);
  if (!q) return json({ results: [] });
  const rows = (await env.DB.prepare(`
    SELECT p.id, p.name, p.title, p.tier, o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, r.name AS rank_name
    FROM people p JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.name LIKE ? ORDER BY p.name LIMIT 40`).bind(`%${q}%`).all()).results;
  const results = rows.filter((e) => userTier(user, e.compartment) >= Math.max(e.tier, e.min_tier)).slice(0, 20)
    .map(({ id, name, title, org_slug, org_name, rank_name }) => ({ id, name, title, org_slug, org_name, rank_name }));
  return json({ results });
}

/* ---------- reports ---------- */

export async function addReport({ env, user, request, params }) {
  const p = await visiblePerson(env, user, params[0]);
  if (!p) return error("No such file, or clearance insufficient", 404);
  const body = await readJson(request);
  const text = body && s(body.body, 20000);
  if (!text) return error("A report needs words in it");
  const tier = Math.min(4, Math.max(p.tier, Number(body.tier) || 0));
  const res = await env.DB.prepare("INSERT INTO reports (person_id, author_id, tier, body) VALUES (?, ?, ?, ?)")
    .bind(p.id, user.id, tier, text).run();
  await env.DB.prepare("UPDATE people SET updated_at = datetime('now') WHERE id = ?").bind(p.id).run();
  return json({ id: res.meta.last_row_id, tier, visible: userTier(user, p.compartment) >= tier }, 201);
}

export async function deleteReport({ env, user, params }) {
  const r = await env.DB.prepare("SELECT id, author_id, person_id FROM reports WHERE id = ?").bind(params[0]).first();
  if (!r) return error("No such report", 404);
  if (!isAdmin(user) && r.author_id !== user.id) return error("Only the author or an admin may remove a report", 403);
  if (!(await visiblePerson(env, user, r.person_id))) return error("Clearance insufficient", 403);
  await env.DB.prepare("DELETE FROM reports WHERE id = ?").bind(r.id).run();
  return json({ ok: true });
}
