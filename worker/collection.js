// The Collection: people, their files, reports and chart positions.
// Every read applies the clearance rule; every write is recorded with the
// Curator's id. Anyone may file a person or a report; who can read it is
// decided by tier and compartment, by an organization being open to all,
// or by Abt. II Schatten's broad scope, which shows every tree but nothing
// of the people in compartments the Curator does not hold.

import { json, error } from "./auth.js";
import { isAdmin, userTier, orgAccess, personAccess, sameDivision, incidentStub } from "./db.js";

// Investigative statuses for the Collection; personnel statuses for an open (Party) tab.
const STATUSES = ["watched", "referred", "closed", "cleared", "serving", "probation", "leave", "retired"];
const SEVERITIES = ["severe", "moderate", "minor"];
const MAX_PORTRAIT = 400_000; // characters of data URL (~300 KB image)
const ORG_COLS = "id, slug, name, long_name, compartment, min_tier, sort, access";

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
  return env.DB.prepare(`SELECT ${ORG_COLS} FROM organizations WHERE id = ?`).bind(id).first();
}

// Load a person with their organization, and check the caller may read the file.
export async function visiblePerson(env, user, id) {
  const p = await env.DB.prepare(`
    SELECT p.*, o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, o.access, r.name AS rank_name, r.band AS rank_band
    FROM people p JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.id = ?`).bind(id).first();
  if (!p) return null;
  return personAccess(user, p, p.tier, p) === "full" ? p : null;
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

// The tier a reader may read reports at, in this person's organization.
function readTier(user, p) {
  const a = orgAccess(user, p);
  if (a === "full") return 4;
  if (a === "tiered") return userTier(user, p.compartment);
  return 0;
}

/* ---------- organizations ---------- */

export async function listOrgs({ env, user }) {
  const orgs = (await env.DB.prepare(`SELECT ${ORG_COLS} FROM organizations ORDER BY sort`).all()).results;
  const ranks = (await env.DB.prepare("SELECT id, org_id, name, band, tier, sort FROM ranks ORDER BY org_id, sort").all()).results;
  const visible = [];
  for (const o of orgs) {
    const mode = orgAccess(user, o);
    if (!mode) continue;
    visible.push({ ...o, mode, tier: mode === "full" ? 4 : userTier(user, o.compartment),
      ranks: ranks.filter((r) => r.org_id === o.id).map(({ id, name, band, tier }) => ({ id, name, band, tier })) });
  }
  // Every org (for the filing form), even where the author cannot read.
  const all = orgs.map(({ id, slug, name, compartment, min_tier, access }) => ({ id, slug, name, compartment, min_tier, access,
    ranks: ranks.filter((r) => r.org_id === id).map(({ id, name, band, tier }) => ({ id, name, band, tier })) }));
  return json({ orgs: visible, all });
}

/* ---------- people ---------- */

// What a Curator is told about a person they may not read in full.
export function stubOf(user, e) {
  const a = personAccess(user, e, e.tier, e);
  if (a === "full") {
    const { id, name, title, org_slug, org_name, rank_name } = e;
    return { id, name, title, org_slug, org_name, rank_name };
  }
  if (a === "redacted") return { id: e.id, name: e.name, rank_name: e.rank_name || e.rank_text || null, redacted: 1, tier: Math.max(e.tier, e.min_tier) };
  if (a === "bare") return { id: e.id, redacted: 1, bare: 1 };
  return null;
}

export async function listPeople({ env, user, url }) {
  const slug = url.searchParams.get("org");
  const org = await env.DB.prepare(`SELECT ${ORG_COLS} FROM organizations WHERE slug = ?`).bind(slug).first();
  if (!org) return error("Unknown organization", 404);
  const mode = orgAccess(user, org);
  if (!mode) return error("Clearance insufficient", 403);
  const t = mode === "full" ? 4 : userTier(user, org.compartment);

  const rows = (await env.DB.prepare(`
    SELECT p.id, p.name, p.title, p.rank_text, p.party_member, p.status, p.tier, p.reports_to, p.x, p.y, p.division,
           p.updated_at, r.name AS rank_name, r.band AS rank_band, r.sort AS rank_sort,
           CASE WHEN p.portrait IS NULL THEN 0 ELSE 1 END AS has_portrait,
           (SELECT COUNT(*) FROM reports rp WHERE rp.person_id = p.id AND rp.tier <= ?) AS report_count
    FROM people p LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.org_id = ?
    ORDER BY COALESCE(r.sort, 999), p.name`).bind(t, org.id).all()).results;

  const people = rows.map((p) => {
    if (mode === "bare" || (mode === "full" && !sameDivision(user, p))) return { id: p.id, redacted: 1, bare: 1, reports_to: p.reports_to, x: p.x, y: p.y, rank_sort: p.rank_sort };
    if (p.tier <= t) return p;
    return { id: p.id, name: p.name, rank_name: p.rank_name || p.rank_text || null, rank_sort: p.rank_sort, redacted: 1, tier: p.tier, reports_to: p.reports_to, x: p.x, y: p.y };
  });

  // Superiors who sit in another organization.
  const ids = new Set(people.map((p) => p.id));
  const extIds = [...new Set(people.map((p) => p.reports_to).filter((id) => id && !ids.has(id)))];
  let externals = [];
  if (extIds.length) {
    const ext = (await env.DB.prepare(`
      SELECT p.id, p.name, p.tier, p.title, p.rank_text, o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, o.access, r.name AS rank_name
      FROM people p JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id
      WHERE p.id IN (${extIds.map(() => "?").join(",")})`).bind(...extIds).all()).results;
    externals = ext.map((e) => stubOf(user, e) || { id: e.id, redacted: 1, bare: 1 });
  }
  return json({ org: { ...org, tier: t, mode }, people, externals });
}

export async function getPerson({ env, user, params }) {
  const p = await visiblePerson(env, user, params[0]);
  if (!p) return error("No such file, or clearance insufficient", 404);
  const t = readTier(user, p);
  const reports = (await env.DB.prepare(`
    SELECT rp.id, rp.tier, rp.title, rp.severity, rp.body, rp.created_at, rp.author_id, u.name AS author_name
    FROM reports rp LEFT JOIN users u ON u.id = rp.author_id
    WHERE rp.person_id = ? AND rp.tier <= ? ORDER BY rp.created_at DESC, rp.id DESC`).bind(p.id, t).all()).results;
  const withheld = (await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE person_id = ? AND tier > ?").bind(p.id, t).first()).n;
  const superior = p.reports_to ? await stub(env, user, p.reports_to) : null;
  const subs = (await env.DB.prepare(`
    SELECT p.id, p.name, p.title, p.tier, p.rank_text, p.division, o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, o.access, r.name AS rank_name
    FROM people p JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.reports_to = ? ORDER BY p.name`).bind(p.id).all()).results.map((e) => stubOf(user, e) || { id: e.id, redacted: 1, bare: 1 });
  const creator = p.created_by ? await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(p.created_by).first() : null;
  // Incidents this person is attached to, each told at the reader's clearance.
  const incRows = (await env.DB.prepare(`
    SELECT ip.role, i.id, i.title, i.compartment, i.tier, i.severity, i.status, i.occurred_on, i.where_text, i.summary, i.officer_id, i.created_at, i.updated_at,
           u.name AS officer_name, u.rank AS officer_rank, u.person_id AS officer_person_id
    FROM incident_people ip JOIN incidents i ON i.id = ip.incident_id LEFT JOIN users u ON u.id = i.officer_id
    WHERE ip.person_id = ? ORDER BY i.id DESC`).bind(p.id).all()).results;
  const incidents = incRows.map((r) => { const st = incidentStub(user, r); return st ? { ...st, role: r.role } : null; }).filter(Boolean);
  return json({
    person: { ...p, created_by_name: creator ? creator.name : null },
    reports, withheld, superior, subordinates: subs, incidents, readTier: t,
    can: { edit: true, delete: isAdmin(user), admin: isAdmin(user), me: user.id },
  });
}

async function stub(env, user, id) {
  const e = await env.DB.prepare(`
    SELECT p.id, p.name, p.title, p.tier, p.rank_text, p.division, o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, o.access, r.name AS rank_name
    FROM people p JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id WHERE p.id = ?`).bind(id).first();
  return e ? (stubOf(user, e) || { id: e.id, redacted: 1, bare: 1 }) : null;
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
  const DIVS = ["government", "secret", "public"];
  const divList = Array.isArray(body.division) ? body.division : String(body.division || "").split(",");
  const division = DIVS.filter((d) => divList.map((x) => String(x).trim().toLowerCase()).includes(d)).join(",") || null;
  return {
    ok: {
      name, org_id: org.id, rank_id, rank_text: s(body.rank_text, 120), title: s(body.title, 160),
      party_member, status, info: s(body.info, 20000), reports_to, tier, division,
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
    INSERT INTO people (org_id, rank_id, rank_text, title, name, party_member, status, tier, info, portrait, reports_to, division, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(d.org_id, d.rank_id, d.rank_text, d.title, d.name, d.party_member, d.status, d.tier, d.info, d.portrait || null, d.reports_to, d.division, user.id)
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
      info = ?, portrait = ?, reports_to = ?, division = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(d.org_id, d.rank_id, d.rank_text, d.title, d.name, d.party_member, d.status, d.tier, d.info, portrait, d.reports_to, d.division, p.id)
    .run();
  const visible = !!(await visiblePerson(env, user, p.id));
  return json({ id: p.id, visible });
}

export async function deletePerson({ env, params }) {
  await env.DB.prepare("DELETE FROM reports WHERE person_id = ?").bind(params[0]).run();
  await env.DB.prepare("DELETE FROM incident_people WHERE person_id = ?").bind(params[0]).run();
  await env.DB.prepare("UPDATE people SET reports_to = NULL WHERE reports_to = ?").bind(params[0]).run();
  await env.DB.prepare("DELETE FROM people WHERE id = ?").bind(params[0]).run();
  return json({ ok: true });
}

// Attach a person to a superior (or detach with null), from the chart's nibs
// or the file panel. Both files must be readable; loops are refused.
export async function setSuperior({ env, user, request, params }) {
  const p = await visiblePerson(env, user, params[0]);
  if (!p) return error("No such file, or clearance insufficient", 404);
  const body = await readJson(request);
  if (!body) return error("Bad request");
  const sup = body.reports_to ? Number(body.reports_to) : null;
  if (sup) {
    if (sup === p.id) return error("A person cannot report to themselves");
    if (!(await visiblePerson(env, user, sup))) return error("No such file, or clearance insufficient", 404);
    let cur = sup, guard = 0;
    while (cur && guard++ < 200) {
      const r = await env.DB.prepare("SELECT reports_to FROM people WHERE id = ?").bind(cur).first();
      if (!r || !r.reports_to) break;
      if (r.reports_to === p.id) return error("That would make a loop in the chain of command");
      cur = r.reports_to;
    }
  }
  await env.DB.prepare("UPDATE people SET reports_to = ?, updated_at = datetime('now') WHERE id = ?").bind(sup, p.id).run();
  return json({ ok: true, reports_to: sup });
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
    SELECT p.id, p.name, p.title, p.tier, p.rank_text, p.division, o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, o.access, r.name AS rank_name
    FROM people p JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.name LIKE ? ORDER BY p.name LIMIT 40`).bind(`%${q}%`).all()).results;
  const results = rows.filter((e) => personAccess(user, e, e.tier, e) === "full").slice(0, 20)
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
  const title = s(body.title, 120);
  if (!title) return error("Give the report a title");
  const severity = SEVERITIES.includes(body.severity) ? body.severity : "minor";
  const tier = Math.min(4, Math.max(p.tier, Number(body.tier) || 0));
  const res = await env.DB.prepare("INSERT INTO reports (person_id, author_id, tier, title, severity, body) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(p.id, user.id, tier, title, severity, text).run();
  await env.DB.prepare("UPDATE people SET updated_at = datetime('now') WHERE id = ?").bind(p.id).run();
  return json({ id: res.meta.last_row_id, tier, visible: readTier(user, p) >= tier }, 201);
}

export async function deleteReport({ env, user, params }) {
  const r = await env.DB.prepare("SELECT id, author_id, person_id FROM reports WHERE id = ?").bind(params[0]).first();
  if (!r) return error("No such report", 404);
  if (!isAdmin(user) && r.author_id !== user.id) return error("Only the author or an admin may remove a report", 403);
  if (!(await visiblePerson(env, user, r.person_id))) return error("Clearance insufficient", 403);
  await env.DB.prepare("DELETE FROM reports WHERE id = ?").bind(r.id).run();
  return json({ ok: true });
}
