// The Wire: the Department's rooms. Everyone and Announcements are open to
// every member; each division has a room for those who sit in it. Only
// admins post in Announcements. Two members may open a private room between
// them (dm:<lower id>-<higher id>), read by no one else. Messages are kept;
// a deleted one leaves a marker. A message may carry @-names as
// @[Name](u:<user id>) or @[Name](p:<person id>) tokens, which the page
// turns into links to the person's card. Delivery is by polling.

import { json, error } from "./auth.js";
import { isAdmin, divisionsOf } from "./db.js";

const MAX_BODY = 2000;
const PAGE = 100;

const DIV_ROOMS = {
  government: { id: "div:government", name: "Abt. I · Regierung", kind: "division" },
  secret: { id: "div:secret", name: "Abt. II · Schatten", kind: "division" },
  public: { id: "div:public", name: "Abt. III · Öffentlichkeit", kind: "division" },
};

// Rooms this user may read, in the order the page shows them: the shared
// rooms first, then every private room they are part of.
export async function roomsFor(env, user) {
  const rooms = [
    { id: "announcements", name: "Announcements", kind: "announcements", canPost: isAdmin(user) },
    { id: "everyone", name: "Everyone", kind: "everyone", canPost: true },
  ];
  const mine = isAdmin(user) ? ["government", "secret", "public"] : divisionsOf(user);
  for (const d of ["government", "secret", "public"]) {
    if (mine.includes(d)) rooms.push({ ...DIV_ROOMS[d], canPost: true });
  }
  const dms = (await env.DB.prepare(`
    SELECT d.room, d.a, d.b, ua.name AS a_name, ua.rank AS a_rank, ua.person_id AS a_person, ub.name AS b_name, ub.rank AS b_rank, ub.person_id AS b_person
    FROM dms d JOIN users ua ON ua.id = d.a JOIN users ub ON ub.id = d.b WHERE d.a = ? OR d.b = ? ORDER BY d.created_at`).bind(user.id, user.id).all()).results;
  for (const d of dms) {
    const other = d.a === user.id ? { id: d.b, name: d.b_name, rank: d.b_rank, person_id: d.b_person } : { id: d.a, name: d.a_name, rank: d.a_rank, person_id: d.a_person };
    rooms.push({ id: d.room, name: other.name, kind: "dm", canPost: true, other });
  }
  return rooms;
}

// A private room's id, the same whichever of the two opens it.
function dmRoom(a, b) {
  return a < b ? `dm:${a}-${b}` : `dm:${b}-${a}`;
}

async function roomFor(env, user, id) {
  const rooms = await roomsFor(env, user);
  const found = rooms.find((r) => r.id === id);
  if (found) return found;
  // A private room not yet opened: valid if the caller is one of the pair and the other is on the roll.
  const m = String(id).match(/^dm:(\d+)-(\d+)$/);
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a >= b || (a !== user.id && b !== user.id)) return null;
  const otherId = a === user.id ? b : a;
  const other = await env.DB.prepare("SELECT id, name, rank, person_id FROM users WHERE id = ? AND active = 1").bind(otherId).first();
  if (!other) return null;
  return { id, name: other.name, kind: "dm", canPost: true, other, unopened: true };
}

// Open (or find) the private room between the caller and another member.
export async function openDm({ env, user, request }) {
  const b = await readJson(request);
  const otherId = Number(b && b.user_id);
  if (!otherId || otherId === user.id) return error("Choose someone else on the roll");
  const other = await env.DB.prepare("SELECT id, name FROM users WHERE id = ? AND active = 1").bind(otherId).first();
  if (!other) return error("No one by that id on the roll", 404);
  const room = dmRoom(user.id, otherId);
  await env.DB.prepare("INSERT OR IGNORE INTO dms (room, a, b) VALUES (?, ?, ?)").bind(room, Math.min(user.id, otherId), Math.max(user.id, otherId)).run();
  return json({ room });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

/* ---------- rooms and unread counts ---------- */

export async function listRooms({ env, user }) {
  const rooms = await roomsFor(env, user);
  const reads = (await env.DB.prepare("SELECT room, last_id FROM room_reads WHERE user_id = ?").bind(user.id).all()).results;
  const seen = Object.fromEntries(reads.map((r) => [r.room, r.last_id]));
  const out = [];
  for (const r of rooms) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(id) AS last FROM messages WHERE room = ? AND deleted = 0 AND id > ?")
      .bind(r.id, seen[r.id] || 0).first();
    out.push({ ...r, unread: row.n, last: row.last || seen[r.id] || 0 });
  }
  // Private rooms: the most recently active first.
  const shared = out.filter((r) => r.kind !== "dm"), dms = out.filter((r) => r.kind === "dm").sort((a, b) => b.last - a.last);
  const all = [...shared, ...dms];
  return json({ rooms: all, unread: all.reduce((s, r) => s + r.unread, 0) });
}

/* ---------- messages ---------- */

export async function listMessages({ env, user, url, params }) {
  const room = await roomFor(env, user, params[0]);
  if (!room) return error("No such room", 404);
  const after = Number(url.searchParams.get("after") || 0);
  let rows;
  if (after > 0) {
    rows = (await env.DB.prepare("SELECT id, author_id, author_name, author_rank, body, deleted, created_at FROM messages WHERE room = ? AND id > ? ORDER BY id ASC LIMIT ?")
      .bind(room.id, after, PAGE).all()).results;
  } else {
    rows = (await env.DB.prepare("SELECT id, author_id, author_name, author_rank, body, deleted, created_at FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?")
      .bind(room.id, PAGE).all()).results.reverse();
  }
  const messages = rows.map((m) => ({ ...m, body: m.deleted ? "" : m.body, mine: m.author_id === user.id, canDelete: !m.deleted && (isAdmin(user) || m.author_id === user.id) }));
  return json({ room, messages });
}

export async function olderMessages({ env, user, url, params }) {
  const room = await roomFor(env, user, params[0]);
  if (!room) return error("No such room", 404);
  const before = Number(url.searchParams.get("before") || 0);
  if (!before) return json({ messages: [] });
  const rows = (await env.DB.prepare("SELECT id, author_id, author_name, author_rank, body, deleted, created_at FROM messages WHERE room = ? AND id < ? ORDER BY id DESC LIMIT ?")
    .bind(room.id, before, PAGE).all()).results.reverse();
  return json({ messages: rows.map((m) => ({ ...m, body: m.deleted ? "" : m.body, mine: m.author_id === user.id, canDelete: !m.deleted && (isAdmin(user) || m.author_id === user.id) })) });
}

export async function postMessage({ env, user, request, params }) {
  const room = await roomFor(env, user, params[0]);
  if (!room) return error("No such room", 404);
  if (!room.canPost) return error("Only the Office posts in Announcements", 403);
  const b = await readJson(request);
  const body = b && String(b.body || "").replace(/\r\n/g, "\n").trim();
  if (!body) return error("Say something");
  if (body.length > MAX_BODY) return error(`At most ${MAX_BODY} characters`);
  if (room.unopened) await env.DB.prepare("INSERT OR IGNORE INTO dms (room, a, b) VALUES (?, ?, ?)").bind(room.id, Math.min(user.id, room.other.id), Math.max(user.id, room.other.id)).run();
  const res = await env.DB.prepare("INSERT INTO messages (room, author_id, author_name, author_rank, body) VALUES (?, ?, ?, ?, ?)")
    .bind(room.id, user.id, user.name, user.rank || (isAdmin(user) ? "Admin" : "Curator"), body).run();
  const id = res.meta.last_row_id;
  await markRead(env, user.id, room.id, id);
  return json({ id }, 201);
}

export async function deleteMessage({ env, user, params }) {
  const m = await env.DB.prepare("SELECT id, room, author_id FROM messages WHERE id = ?").bind(params[0]).first();
  if (!m) return error("No such message", 404);
  if (!(await roomFor(env, user, m.room))) return error("No such room", 404);
  if (!isAdmin(user) && m.author_id !== user.id) return error("Only the author or an admin may remove a message", 403);
  await env.DB.prepare("UPDATE messages SET deleted = 1, body = '' WHERE id = ?").bind(m.id).run();
  return json({ ok: true });
}

/* ---------- read markers ---------- */

async function markRead(env, userId, room, lastId) {
  await env.DB.prepare(`
    INSERT INTO room_reads (user_id, room, last_id) VALUES (?, ?, ?)
    ON CONFLICT(user_id, room) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`)
    .bind(userId, room, lastId).run();
}

export async function read({ env, user, request, params }) {
  const room = await roomFor(env, user, params[0]);
  if (!room) return error("No such room", 404);
  const b = await readJson(request);
  const last = Number(b && b.last) || 0;
  if (last > 0) await markRead(env, user.id, room.id, last);
  return json({ ok: true });
}
