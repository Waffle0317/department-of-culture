// Department of Culture — Worker entry.
// Serves the static site from ./public and runs the personnel gate, the
// login, the Collection API and the admin API in front of it. Paths listed
// in wrangler.jsonc under assets.run_worker_first reach this Worker before
// any static file.

import {
  getMembers, hashPassword, verifyPassword, createSession, readSession, sessionCookie, clearCookie,
  safeNext, redirect, json, error,
} from "./auth.js";
import { ensureSchema, getSessionSecret, loadUser, isAdmin, userTier, inSchatten } from "./db.js";
import * as col from "./collection.js";
import * as adm from "./admin.js";
import * as notes from "./notes.js";
import * as chat from "./chat.js";
import * as inc from "./incidents.js";

// A throwaway hash so a failed lookup costs the same time as a failed password.
const DECOY = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// [method, pattern, handler, access]  access: "public" | "user" | "admin"
const ROUTES = [
  ["POST",   /^\/api\/login$/,                                login,            "public"],
  ["GET",    /^\/api\/login$/,                                () => redirect("/login/"), "public"],
  ["GET",    /^\/api\/logout$/,                               logout,           "public"],
  ["POST",   /^\/api\/logout$/,                               logout,           "public"],
  ["GET",    /^\/api\/me$/,                                   me,               "user"],
  ["POST",   /^\/api\/password$/,                             changePassword,   "user"],
  ["GET",    /^\/api\/status$/,                               status,           "public"],
  ["POST",   /^\/api\/found$/,                                found,            "public"],

  ["GET",    /^\/api\/collection\/orgs$/,                     col.listOrgs,     "user"],
  ["GET",    /^\/api\/collection\/people$/,                   col.listPeople,   "user"],
  ["POST",   /^\/api\/collection\/people$/,                   col.createPerson, "user"],
  ["GET",    /^\/api\/collection\/search$/,                   col.search,       "user"],
  ["GET",    /^\/api\/collection\/people\/(\d+)$/,            col.getPerson,    "user"],
  ["PUT",    /^\/api\/collection\/people\/(\d+)$/,            col.updatePerson, "user"],
  ["DELETE", /^\/api\/collection\/people\/(\d+)$/,            col.deletePerson, "admin"],
  ["PUT",    /^\/api\/collection\/people\/(\d+)\/position$/,  col.setPosition,  "user"],
  ["PUT",    /^\/api\/collection\/people\/(\d+)\/superior$/,  col.setSuperior,  "user"],
  ["POST",   /^\/api\/collection\/people\/(\d+)\/reports$/,   col.addReport,    "user"],
  ["DELETE", /^\/api\/collection\/reports\/(\d+)$/,           col.deleteReport, "user"],

  ["GET",    /^\/api\/members$/,                              inc.listMembers,     "user"],
  ["GET",    /^\/api\/collection\/incidents$/,                inc.listIncidents,   "user"],
  ["POST",   /^\/api\/collection\/incidents$/,                inc.createIncident,  "user"],
  ["GET",    /^\/api\/collection\/incidents\/(\d+)$/,         inc.getIncident,     "user"],
  ["PUT",    /^\/api\/collection\/incidents\/(\d+)$/,         inc.updateIncident,  "user"],
  ["DELETE", /^\/api\/collection\/incidents\/(\d+)$/,         inc.deleteIncident,  "user"],
  ["PUT",    /^\/api\/collection\/incidents\/(\d+)\/status$/, inc.setStatus,       "user"],
  ["POST",   /^\/api\/collection\/incidents\/(\d+)\/notes$/,  inc.addNote,         "user"],
  ["PUT",    /^\/api\/collection\/incidents\/(\d+)\/notes\/(\d+)$/, inc.updateNote, "user"],
  ["DELETE", /^\/api\/collection\/incidents\/(\d+)\/notes\/(\d+)$/, inc.deleteNote, "user"],
  ["POST",   /^\/api\/collection\/incidents\/(\d+)\/people$/, inc.attachPerson,    "user"],
  ["DELETE", /^\/api\/collection\/incidents\/(\d+)\/people\/(\d+)$/, inc.detachPerson, "user"],
  ["POST",   /^\/api\/collection\/incidents\/(\d+)\/links$/,  inc.linkIncident,    "user"],
  ["DELETE", /^\/api\/collection\/incidents\/(\d+)\/links\/(\d+)$/, inc.unlinkIncident, "user"],
  ["POST",   /^\/api\/collection\/incidents\/(\d+)\/attachments$/, inc.addAttachment, "user"],
  ["DELETE", /^\/api\/collection\/attachments\/(\d+)$/,       inc.deleteAttachment, "user"],
  ["GET",    /^\/api\/collection\/attachments\/(\d+)\/image$/, inc.attachmentImage, "user"],

  ["POST",   /^\/api\/box70$/,                                box70,            "public"],
  ["GET",    /^\/api\/notes$/,                                notes.list,       "user"],
  ["POST",   /^\/api\/notes\/(\d+)\/restrict$/,               notes.restrict,   "user"],
  ["POST",   /^\/api\/notes\/(\d+)\/unrestrict$/,             notes.unrestrict, "user"],
  ["DELETE", /^\/api\/notes\/(\d+)$/,                         notes.remove,     "user"],

  ["GET",    /^\/api\/chat\/rooms$/,                          chat.listRooms,     "user"],
  ["POST",   /^\/api\/chat\/dm$/,                              chat.openDm,        "user"],
  ["GET",    /^\/api\/chat\/rooms\/([a-z0-9:-]+)$/,           chat.listMessages,  "user"],
  ["GET",    /^\/api\/chat\/rooms\/([a-z0-9:-]+)\/older$/,    chat.olderMessages, "user"],
  ["POST",   /^\/api\/chat\/rooms\/([a-z0-9:-]+)$/,           chat.postMessage,   "user"],
  ["POST",   /^\/api\/chat\/rooms\/([a-z0-9:-]+)\/read$/,     chat.read,          "user"],
  ["DELETE", /^\/api\/chat\/messages\/(\d+)$/,                chat.deleteMessage, "user"],

  ["GET",    /^\/api\/admin\/users$/,                         adm.listUsers,    "admin"],
  ["POST",   /^\/api\/admin\/users$/,                         adm.createUser,   "admin"],
  ["PUT",    /^\/api\/admin\/users\/(\d+)$/,                  adm.updateUser,   "admin"],
  ["DELETE", /^\/api\/admin\/users\/(\d+)$/,                  adm.deleteUser,   "admin"],
  ["GET",    /^\/api\/admin\/orgs$/,                          adm.listOrgs,     "admin"],
  ["PUT",    /^\/api\/admin\/orgs\/(\d+)$/,                   adm.updateOrg,    "admin"],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) return api(request, env, url, path);
    if (path === "/department" || path.startsWith("/department/")) return gate(request, env, path);
    return env.ASSETS.fetch(request);
  },
};

async function currentUser(request, env) {
  if (!env.DB) return null;
  await ensureSchema(env);
  const session = await readSession(request, getSessionSecret(env));
  return loadUser(env, session);
}

async function api(request, env, url, path) {
  for (const [method, pattern, handler, access] of ROUTES) {
    if (method !== request.method) continue;
    const m = path.match(pattern);
    if (!m) continue;
    try {
      let user = null;
      if (access !== "public") {
        user = await currentUser(request, env);
        if (!user) return error("Sign in required", 401);
        if (access === "admin" && !isAdmin(user)) return error("Admin only", 403);
        // A temporary password opens nothing but the page to replace it.
        if (user.must_change && !/^\/api\/(password|me|logout)$/.test(path)) return error("Choose your own word of passage first", 403);
      }
      return await handler({ request, env, url, user, params: m.slice(1).map((v) => (/^\d+$/.test(v) ? Number(v) : v)) });
    } catch (e) {
      console.error(e);
      return error("Server error: " + (e && e.message ? e.message : String(e)), 500);
    }
  }
  return error("Not found", 404);
}

async function login({ request, env }) {
  if (!env.DB) return redirect("/login/?error=config");
  await ensureSchema(env);
  const form = await request.formData();
  const username = String(form.get("user") || "").trim().toLowerCase();
  const pass = String(form.get("pass") || "");
  const next = safeNext(form.get("next"));

  const user = await env.DB.prepare("SELECT id, username, pass_hash, active, must_change FROM users WHERE username = ?").bind(username).first();
  const ok = user && user.active ? await verifyPassword(pass, user.pass_hash) : (await verifyPassword(pass, DECOY), false);
  if (!ok) {
    // Nobody on the roll at all means the first-run import had no MEMBERS secret to read.
    const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n;
    if (count === 0) return redirect("/login/?error=empty");
    return redirect(`/login/?error=1&next=${encodeURIComponent(next)}`);
  }

  const token = await createSession(user, getSessionSecret(env));
  // Every sign-in is noted for the admin hub's roll.
  await env.DB.prepare("INSERT INTO logins (user_id) VALUES (?)").bind(user.id).run();
  // A temporary password goes straight to the page that replaces it.
  const dest = user.must_change ? `/department/password/?next=${encodeURIComponent(next)}` : next;
  return redirect(dest, { "Set-Cookie": sessionCookie(token) });
}

// A Curator replaces a temporary password (or changes their own at any time).
async function changePassword({ request, env, user }) {
  const form = await request.formData();
  const pass = String(form.get("pass") || "");
  const pass2 = String(form.get("pass2") || "");
  const next = safeNext(form.get("next"));
  const back = `/department/password/?next=${encodeURIComponent(next)}`;
  if (pass.length < 6) return redirect(back + "&error=short");
  if (pass !== pass2) return redirect(back + "&error=match");
  const current = await env.DB.prepare("SELECT pass_hash FROM users WHERE id = ?").bind(user.id).first();
  if (await verifyPassword(pass, current.pass_hash)) return redirect(back + "&error=same");
  await env.DB.prepare("UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?").bind(await hashPassword(pass), user.id).run();
  return redirect(next);
}

function logout() {
  return redirect("/", { "Set-Cookie": clearCookie() });
}

async function box70(ctx) {
  if (!ctx.env.DB) return redirect("/box-70/?error=down");
  await ensureSchema(ctx.env);
  return notes.submit(ctx);
}

// Health of the installation, without revealing anything secret.
async function status({ env }) {
  if (!env.DB) return json({ db: false, users: 0, members: "absent" });
  await ensureSchema(env);
  const users = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n;
  const members = !env.MEMBERS ? "absent" : getMembers(env) ? "ok" : "unreadable";
  return json({ db: true, users, members, needsFounding: users === 0 });
}

// First run only: while the roll is empty, the first visitor founds it by
// creating the Director's account. Refused as soon as any user exists.
async function found({ request, env }) {
  if (!env.DB) return redirect("/login/?error=config");
  await ensureSchema(env);
  const users = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n;
  if (users > 0) return redirect("/login/?error=1");
  const form = await request.formData();
  const username = String(form.get("user") || "").trim().toLowerCase();
  const name = String(form.get("name") || "").trim();
  const pass = String(form.get("pass") || "");
  const pass2 = String(form.get("pass2") || "");
  if (!/^[a-z0-9._-]{2,40}$/.test(username) || !name || pass.length < 6 || pass !== pass2) {
    return redirect("/login/?error=found");
  }
  const res = await env.DB.prepare(`
    INSERT INTO users (username, name, role, division, tier_public, tier_secret, tier_government, tier4, pass_hash)
    VALUES (?, ?, 'admin', 'government', 3, 3, 3, 1, ?)`).bind(username, name, await hashPassword(pass)).run();
  const user = { id: res.meta.last_row_id, username };
  const token = await createSession(user, getSessionSecret(env));
  return redirect("/department/", { "Set-Cookie": sessionCookie(token) });
}

function me({ user }) {
  return json({
    id: user.id,
    user: user.username,
    name: user.name,
    role: user.role === "admin" ? "Admin" : "Curator",
    rank: user.rank || null,
    admin: isAdmin(user),
    division: user.division,
    divisions: String(user.division || "").split(",").filter(Boolean),
    tiers: {
      public: userTier(user, "public"),
      secret: userTier(user, "secret"),
      government: userTier(user, "government"),
    },
    tier4: !!user.tier4,
    schatten: inSchatten(user),
    mustChange: !!user.must_change,
  });
}

async function gate(request, env, path) {
  if (!env.DB) return redirect("/login/?error=config");
  const user = await currentUser(request, env);
  if (!user) return redirect(`/login/?next=${encodeURIComponent(path)}`);
  if (user.must_change && !path.startsWith("/department/password")) return redirect(`/department/password/?next=${encodeURIComponent(path)}`);
  if (path.startsWith("/department/admin") && !isAdmin(user)) return redirect("/department/");
  const asset = await env.ASSETS.fetch(request);
  const out = new Response(asset.body, asset);
  out.headers.set("Cache-Control", "private, no-store");
  out.headers.set("X-Robots-Tag", "noindex");
  return out;
}
