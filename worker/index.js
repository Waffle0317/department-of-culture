// Department of Culture — Worker entry.
// Serves the static site from ./public and runs the personnel gate, the
// login, the Collection API and the admin API in front of it. Paths listed
// in wrangler.jsonc under assets.run_worker_first reach this Worker before
// any static file.

import {
  verifyPassword, createSession, readSession, sessionCookie, clearCookie,
  safeNext, redirect, json, error,
} from "./auth.js";
import { ensureSchema, loadUser, isAdmin, userTier } from "./db.js";
import * as col from "./collection.js";
import * as adm from "./admin.js";

// A throwaway hash so a failed lookup costs the same time as a failed password.
const DECOY = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// [method, pattern, handler, access]  access: "public" | "user" | "admin"
const ROUTES = [
  ["POST",   /^\/api\/login$/,                                login,            "public"],
  ["GET",    /^\/api\/login$/,                                () => redirect("/login/"), "public"],
  ["GET",    /^\/api\/logout$/,                               logout,           "public"],
  ["POST",   /^\/api\/logout$/,                               logout,           "public"],
  ["GET",    /^\/api\/me$/,                                   me,               "user"],

  ["GET",    /^\/api\/collection\/orgs$/,                     col.listOrgs,     "user"],
  ["GET",    /^\/api\/collection\/people$/,                   col.listPeople,   "user"],
  ["POST",   /^\/api\/collection\/people$/,                   col.createPerson, "user"],
  ["GET",    /^\/api\/collection\/search$/,                   col.search,       "user"],
  ["GET",    /^\/api\/collection\/people\/(\d+)$/,            col.getPerson,    "user"],
  ["PUT",    /^\/api\/collection\/people\/(\d+)$/,            col.updatePerson, "user"],
  ["DELETE", /^\/api\/collection\/people\/(\d+)$/,            col.deletePerson, "admin"],
  ["PUT",    /^\/api\/collection\/people\/(\d+)\/position$/,  col.setPosition,  "user"],
  ["POST",   /^\/api\/collection\/people\/(\d+)\/reports$/,   col.addReport,    "user"],
  ["DELETE", /^\/api\/collection\/reports\/(\d+)$/,           col.deleteReport, "user"],

  ["GET",    /^\/api\/admin\/users$/,                         adm.listUsers,    "admin"],
  ["POST",   /^\/api\/admin\/users$/,                         adm.createUser,   "admin"],
  ["PUT",    /^\/api\/admin\/users\/(\d+)$/,                  adm.updateUser,   "admin"],
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
  if (!env.DB || !env.SESSION_SECRET) return null;
  await ensureSchema(env);
  const session = await readSession(request, env.SESSION_SECRET);
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
      }
      return await handler({ request, env, url, user, params: m.slice(1).map(Number) });
    } catch (e) {
      console.error(e);
      return error("Server error: " + (e && e.message ? e.message : String(e)), 500);
    }
  }
  return error("Not found", 404);
}

async function login({ request, env }) {
  if (!env.DB || !env.SESSION_SECRET) return redirect("/login/?error=config");
  await ensureSchema(env);
  const form = await request.formData();
  const username = String(form.get("user") || "").trim().toLowerCase();
  const pass = String(form.get("pass") || "");
  const next = safeNext(form.get("next"));

  const user = await env.DB.prepare("SELECT id, username, pass_hash, active FROM users WHERE username = ?").bind(username).first();
  const ok = user && user.active ? await verifyPassword(pass, user.pass_hash) : (await verifyPassword(pass, DECOY), false);
  if (!ok) return redirect(`/login/?error=1&next=${encodeURIComponent(next)}`);

  const token = await createSession(user, env.SESSION_SECRET);
  return redirect(next, { "Set-Cookie": sessionCookie(token) });
}

function logout() {
  return redirect("/", { "Set-Cookie": clearCookie() });
}

function me({ user }) {
  return json({
    id: user.id,
    user: user.username,
    name: user.name,
    role: user.role === "admin" ? "Admin" : "Curator",
    admin: isAdmin(user),
    division: user.division,
    tiers: {
      public: userTier(user, "public"),
      secret: userTier(user, "secret"),
      government: userTier(user, "government"),
    },
    tier4: !!user.tier4,
  });
}

async function gate(request, env, path) {
  if (!env.DB || !env.SESSION_SECRET) return redirect("/login/?error=config");
  const user = await currentUser(request, env);
  if (!user) return redirect(`/login/?next=${encodeURIComponent(path)}`);
  if (path.startsWith("/department/admin") && !isAdmin(user)) return redirect("/department/");
  const asset = await env.ASSETS.fetch(request);
  const out = new Response(asset.body, asset);
  out.headers.set("Cache-Control", "private, no-store");
  out.headers.set("X-Robots-Tag", "noindex");
  return out;
}
