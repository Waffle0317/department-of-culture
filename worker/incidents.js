// Incidents: events that involve several people. An incident is filed in a
// compartment at a tier, like a person's file, and the case officer always
// reads their own case. People on the Collection are attached with a role,
// incidents link to one another, and images, video links and papers are
// kept with the case. Images are shrunk in the browser and stored here.

import { json, error } from "./auth.js";
import { isAdmin, incidentAccess, incidentStub } from "./db.js";
import { stubOf, visiblePerson } from "./collection.js";

const SEVERITIES = ["severe", "moderate", "minor"];
const STATUSES = ["open", "active", "referred", "closed"];
const ROLES = ["subject", "witness", "informant", "complainant", "officer", "other"];
const KINDS = ["image", "video", "link"];
const COMPARTMENTS = ["public", "secret", "government"];
const MAX_IMAGE = 1_400_000; // characters of data URL (~1 MB image)
const INC_COLS = "i.id, i.title, i.compartment, i.tier, i.severity, i.status, i.occurred_on, i.where_text, i.summary, i.body, i.officer_id, i.created_by, i.created_at, i.updated_at";
const OFFICER = "u.name AS officer_name, u.rank AS officer_rank, u.person_id AS officer_person_id";

async function readJson(request) { try { return await request.json(); } catch { return null; } }
function s(v, max = 2000) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

async function loadIncident(env, id) {
  return env.DB.prepare(`SELECT ${INC_COLS}, ${OFFICER}, c.name AS created_by_name
    FROM incidents i LEFT JOIN users u ON u.id = i.officer_id LEFT JOIN users c ON c.id = i.created_by WHERE i.id = ?`).bind(id).first();
}
export async function visibleIncident(env, user, id) {
  const inc = await loadIncident(env, id);
  return inc && incidentAccess(user, inc) === "full" ? inc : null;
}
async function touch(env, id) {
  await env.DB.prepare("UPDATE incidents SET updated_at = datetime('now') WHERE id = ?").bind(id).run();
}

/* ---------- list and view ---------- */

export async function listIncidents({ env, user, url }) {
  const q = s(url.searchParams.get("q"), 80);
  const rows = (await env.DB.prepare(`
    SELECT ${INC_COLS}, ${OFFICER},
      (SELECT COUNT(*) FROM incident_people ip WHERE ip.incident_id = i.id) AS people_count,
      (SELECT COUNT(*) FROM attachments at WHERE at.incident_id = i.id) AS attachment_count,
      (SELECT COUNT(*) FROM incident_links il WHERE il.a = i.id OR il.b = i.id) AS link_count
    FROM incidents i LEFT JOIN users u ON u.id = i.officer_id
    ${q ? "WHERE i.title LIKE ?" : ""} ORDER BY i.id DESC`).bind(...(q ? [`%${q}%`] : [])).all()).results;
  const incidents = rows.map((r) => incidentStub(user, r, { people_count: r.people_count, attachment_count: r.attachment_count, link_count: r.link_count })).filter(Boolean);
  return json({ incidents });
}

export async function getIncident({ env, user, params }) {
  const inc = await visibleIncident(env, user, params[0]);
  if (!inc) return error("No such incident, or clearance insufficient", 404);
  const people = (await env.DB.prepare(`
    SELECT ip.role, ip.note, p.id, p.name, p.title, p.tier, p.rank_text, p.division,
           o.slug AS org_slug, o.name AS org_name, o.compartment, o.min_tier, o.access, r.name AS rank_name
    FROM incident_people ip JOIN people p ON p.id = ip.person_id JOIN organizations o ON o.id = p.org_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE ip.incident_id = ? ORDER BY ip.rowid`).bind(inc.id).all()).results
    .map((e) => ({ ...(stubOf(user, e) || { id: e.id, redacted: 1, bare: 1 }), role: e.role, note: e.note }));
  const rel = (await env.DB.prepare(`
    SELECT ${INC_COLS}, ${OFFICER}
    FROM incident_links il JOIN incidents i ON i.id = CASE WHEN il.a = ? THEN il.b ELSE il.a END
    LEFT JOIN users u ON u.id = i.officer_id
    WHERE il.a = ? OR il.b = ? ORDER BY i.id DESC`).bind(inc.id, inc.id, inc.id).all()).results;
  const related = rel.map((r) => incidentStub(user, r)).filter(Boolean);
  const attachments = (await env.DB.prepare(`
    SELECT a.id, a.kind, a.title, a.url, a.added_by, a.created_at, u.name AS added_by_name
    FROM attachments a LEFT JOIN users u ON u.id = a.added_by WHERE a.incident_id = ? ORDER BY a.id`).bind(inc.id).all()).results;
  return json({
    incident: inc, people, related, attachments,
    can: { edit: true, delete: isAdmin(user) || inc.created_by === user.id || inc.officer_id === user.id, admin: isAdmin(user), me: user.id },
  });
}

/* ---------- create, amend, destroy ---------- */

async function validate(env, body) {
  const title = s(body.title, 140);
  if (!title) return { err: "Give the incident a title" };
  const compartment = COMPARTMENTS.includes(body.compartment) ? body.compartment : "public";
  const tier = Math.min(4, Math.max(1, Number(body.tier) || 1));
  const severity = SEVERITIES.includes(body.severity) ? body.severity : "minor";
  const status = STATUSES.includes(body.status) ? body.status : "open";
  const officer_id = body.officer_id ? Number(body.officer_id) : null;
  if (officer_id) {
    const u = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND active = 1").bind(officer_id).first();
    if (!u) return { err: "The case officer must be on the roll" };
  }
  let occurred_on = s(body.occurred_on, 10);
  if (occurred_on && !/^\d{4}-\d{2}-\d{2}$/.test(occurred_on)) occurred_on = null;
  return { ok: { title, compartment, tier, severity, status, officer_id, occurred_on,
    where_text: s(body.where_text, 160), summary: s(body.summary, 600), body: s(body.body, 30000) } };
}

export async function createIncident({ env, user, request }) {
  const body = await readJson(request);
  if (!body) return error("Bad request");
  const v = await validate(env, body);
  if (v.err) return error(v.err);
  const d = v.ok;
  const res = await env.DB.prepare(`
    INSERT INTO incidents (title, compartment, tier, severity, status, occurred_on, where_text, summary, body, officer_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(d.title, d.compartment, d.tier, d.severity, d.status, d.occurred_on, d.where_text, d.summary, d.body, d.officer_id, user.id).run();
  const id = res.meta.last_row_id;
  return json({ id, visible: !!(await visibleIncident(env, user, id)) }, 201);
}

export async function updateIncident({ env, user, request, params }) {
  const inc = await visibleIncident(env, user, params[0]);
  if (!inc) return error("No such incident, or clearance insufficient", 404);
  const body = await readJson(request);
  if (!body) return error("Bad request");
  const v = await validate(env, body);
  if (v.err) return error(v.err);
  const d = v.ok;
  await env.DB.prepare(`
    UPDATE incidents SET title = ?, compartment = ?, tier = ?, severity = ?, status = ?, occurred_on = ?, where_text = ?, summary = ?, body = ?, officer_id = ?,
      updated_at = datetime('now') WHERE id = ?`)
    .bind(d.title, d.compartment, d.tier, d.severity, d.status, d.occurred_on, d.where_text, d.summary, d.body, d.officer_id, inc.id).run();
  return json({ id: inc.id, visible: !!(await visibleIncident(env, user, inc.id)) });
}

export async function deleteIncident({ env, user, params }) {
  const inc = await visibleIncident(env, user, params[0]);
  if (!inc) return error("No such incident, or clearance insufficient", 404);
  if (!isAdmin(user) && inc.created_by !== user.id && inc.officer_id !== user.id) return error("Only the case officer, whoever opened it, or an admin may destroy an incident", 403);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM attachments WHERE incident_id = ?").bind(inc.id),
    env.DB.prepare("DELETE FROM incident_people WHERE incident_id = ?").bind(inc.id),
    env.DB.prepare("DELETE FROM incident_links WHERE a = ? OR b = ?").bind(inc.id, inc.id),
    env.DB.prepare("DELETE FROM incidents WHERE id = ?").bind(inc.id),
  ]);
  return json({ ok: true });
}

/* ---------- people on the incident ---------- */

export async function attachPerson({ env, user, request, params }) {
  const inc = await visibleIncident(env, user, params[0]);
  if (!inc) return error("No such incident, or clearance insufficient", 404);
  const body = await readJson(request);
  if (!body) return error("Bad request");
  const p = await visiblePerson(env, user, Number(body.person_id));
  if (!p) return error("No such file, or clearance insufficient", 404);
  const role = ROLES.includes(body.role) ? body.role : "subject";
  await env.DB.prepare(`
    INSERT INTO incident_people (incident_id, person_id, role, note, added_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(incident_id, person_id) DO UPDATE SET role = excluded.role, note = excluded.note`)
    .bind(inc.id, p.id, role, s(body.note, 300), user.id).run();
  await touch(env, inc.id);
  return json({ ok: true });
}

export async function detachPerson({ env, user, params }) {
  const inc = await visibleIncident(env, user, params[0]);
  if (!inc) return error("No such incident, or clearance insufficient", 404);
  await env.DB.prepare("DELETE FROM incident_people WHERE incident_id = ? AND person_id = ?").bind(inc.id, params[1]).run();
  await touch(env, inc.id);
  return json({ ok: true });
}

/* ---------- links between incidents ---------- */

export async function linkIncident({ env, user, request, params }) {
  const inc = await visibleIncident(env, user, params[0]);
  if (!inc) return error("No such incident, or clearance insufficient", 404);
  const body = await readJson(request);
  if (!body) return error("Bad request");
  const other = await visibleIncident(env, user, Number(body.incident_id));
  if (!other) return error("No such incident, or clearance insufficient", 404);
  if (other.id === inc.id) return error("An incident cannot be linked to itself");
  const [a, b] = inc.id < other.id ? [inc.id, other.id] : [other.id, inc.id];
  await env.DB.prepare("INSERT OR IGNORE INTO incident_links (a, b) VALUES (?, ?)").bind(a, b).run();
  await touch(env, inc.id); await touch(env, other.id);
  return json({ ok: true });
}

export async function unlinkIncident({ env, user, params }) {
  const inc = await visibleIncident(env, user, params[0]);
  if (!inc) return error("No such incident, or clearance insufficient", 404);
  const other = Number(params[1]);
  const [a, b] = inc.id < other ? [inc.id, other] : [other, inc.id];
  await env.DB.prepare("DELETE FROM incident_links WHERE a = ? AND b = ?").bind(a, b).run();
  await touch(env, inc.id);
  return json({ ok: true });
}

/* ---------- attachments ---------- */

export async function addAttachment({ env, user, request, params }) {
  const inc = await visibleIncident(env, user, params[0]);
  if (!inc) return error("No such incident, or clearance insufficient", 404);
  const body = await readJson(request);
  if (!body) return error("Bad request");
  const kind = KINDS.includes(body.kind) ? body.kind : "link";
  let title = s(body.title, 140);
  let url = s(body.url, 1000), data = null;
  if (kind === "image") {
    data = typeof body.data === "string" ? body.data : "";
    if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(data)) return error("The image must be a JPEG, PNG, WebP or GIF");
    if (data.length > MAX_IMAGE) return error("That image is too large even after shrinking (1 MB at most)");
    url = null;
  } else {
    if (!url || !/^https?:\/\/\S+$/i.test(url)) return error("Give a full web address, starting https://");
    if (!title) title = url.replace(/^https?:\/\//i, "").slice(0, 140);
  }
  const res = await env.DB.prepare("INSERT INTO attachments (incident_id, kind, title, url, data, added_by) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(inc.id, kind, title, url, data, user.id).run();
  await touch(env, inc.id);
  return json({ id: res.meta.last_row_id }, 201);
}

export async function deleteAttachment({ env, user, params }) {
  const a = await env.DB.prepare("SELECT id, incident_id, added_by FROM attachments WHERE id = ?").bind(params[0]).first();
  if (!a) return error("No such attachment", 404);
  const inc = await visibleIncident(env, user, a.incident_id);
  if (!inc) return error("Clearance insufficient", 403);
  if (!isAdmin(user) && a.added_by !== user.id && inc.officer_id !== user.id) return error("Only whoever added it, the case officer or an admin may remove an attachment", 403);
  await env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(a.id).run();
  await touch(env, inc.id);
  return json({ ok: true });
}

// The image itself, served only to a reader of the incident.
export async function attachmentImage({ env, user, params }) {
  const a = await env.DB.prepare("SELECT incident_id, kind, data FROM attachments WHERE id = ?").bind(params[0]).first();
  if (!a || a.kind !== "image" || !a.data) return error("No such image", 404);
  if (!(await visibleIncident(env, user, a.incident_id))) return error("Clearance insufficient", 403);
  const m = a.data.match(/^data:(image\/[a-z]+);base64,(.*)$/);
  if (!m) return error("Unreadable image", 500);
  const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bin, { headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=3600", "X-Robots-Tag": "noindex" } });
}

/* ---------- the roll, for case officers and @-names ---------- */

export async function listMembers({ env }) {
  const members = (await env.DB.prepare("SELECT id, name, rank, person_id, division FROM users WHERE active = 1 ORDER BY name").all()).results;
  return json({ members });
}
