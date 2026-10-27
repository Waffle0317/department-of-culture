// The Wire: the Department's rooms. Everyone and Announcements are open to
// every member; each division has a room for those who sit in it. Only
// admins post in Announcements. Messages are kept; a deleted one leaves a
// marker. Delivery is by polling, so nothing here holds a connection.

import { json, error } from "./auth.js";
import { isAdmin, divisionsOf } from "./db.js";

const MAX_BODY = 2000;
const PAGE = 100;

const DIV_ROOMS = {
  government: { id: "div:government", name: "Abt. I · Regierung", kind: "division" },
  secret: { id: "div:secret", name: "Abt. II · Schatten", kind: "division" },
  public: { id: "div:public", name: "Abt. III · Öffentlichkeit", kind: "division" },
};

// Rooms this user may read, in the order the page shows them.
export function roomsFor(user) {
  const rooms = [
    { id: "announcements", name: "Announcements", kind: "announcements", canPost: isAdmin(user) },
    { id: "everyone", name: "Everyone", kind: "everyone", canPost: true },
  ];
  const mine = isAdmin(user) ? ["government", "secret", "public"] : divisionsOf(user);
  for (const d of ["government", "secret", "public"]) {
    if (mine.includes(d)) rooms.push({ ...DIV_ROOMS[d], canPost: true });
  }
  return rooms;
}

function roomFor(user, id) {
  return roomsFor(user).find((r) => r.id === id) || null;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

/* ---------- rooms and unread counts ---------- */

export async function listRooms({ env, user }) {
  const rooms = roomsFor(user);
  const reads = (await env.DB.prepare("SELECT room, last_id FROM room_reads WHERE user_id = ?").bind(user.id).all()).results;
  const seen = Object.fromEntries(reads.map((r) => [r.room, r.last_id]));
  const out = [];
  for (const r of rooms) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(id) AS last FROM messages WHERE room = ? AND deleted = 0 AND id > ?")
      .bind(r.id, seen[r.id] || 0).first();
    out.push({ ...r, unread: row.n, last: row.last || seen[r.id] || 0 });
  }
  return json({ rooms: out, unread: out.reduce((s, r) => s + r.unread, 0) });
}

/* ---------- messages ---------- */

export async function listMessages({ env, user, url, params }) {
  const room = roomFor(user, params[0]);
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
  const room = roomFor(user, params[0]);
  if (!room) return error("No such room", 404);
  const before = Number(url.searchParams.get("before") || 0);
  if (!before) return json({ messages: [] });
  const rows = (await env.DB.prepare("SELECT id, author_id, author_name, author_rank, body, deleted, created_at FROM messages WHERE room = ? AND id < ? ORDER BY id DESC LIMIT ?")
    .bind(room.id, before, PAGE).all()).results.reverse();
  return json({ messages: rows.map((m) => ({ ...m, body: m.deleted ? "" : m.body, mine: m.author_id === user.id, canDelete: !m.deleted && (isAdmin(user) || m.author_id === user.id) })) });
}

export async function postMessage({ env, user, request, params }) {
  const room = roomFor(user, params[0]);
  if (!room) return error("No such room", 404);
  if (!room.canPost) return error("Only the Office posts in Announcements", 403);
  const b = await readJson(request);
  const body = b && String(b.body || "").replace(/\r\n/g, "\n").trim();
  if (!body) return error("Say something");
  if (body.length > MAX_BODY) return error(`At most ${MAX_BODY} characters`);
  const res = await env.DB.prepare("INSERT INTO messages (room, author_id, author_name, author_rank, body) VALUES (?, ?, ?, ?, ?)")
    .bind(room.id, user.id, user.name, user.rank || (isAdmin(user) ? "Admin" : "Curator"), body).run();
  const id = res.meta.last_row_id;
  await markRead(env, user.id, room.id, id);
  return json({ id }, 201);
}

export async function deleteMessage({ env, user, params }) {
  const m = await env.DB.prepare("SELECT id, room, author_id FROM messages WHERE id = ?").bind(params[0]).first();
  if (!m) return error("No such message", 404);
  if (!roomFor(user, m.room)) return error("No such room", 404);
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
  const room = roomFor(user, params[0]);
  if (!room) return error("No such room", 404);
  const b = await readJson(request);
  const last = Number(b && b.last) || 0;
  if (last > 0) await markRead(env, user.id, room.id, last);
  return json({ ok: true });
}
