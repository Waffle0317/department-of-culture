// Department of Culture — Worker entry.
// Serves the static site from ./public and runs the personnel gate and
// the login API in front of it. Paths listed in wrangler.jsonc under
// assets.run_worker_first reach this Worker before any static file.

import {
  getMembers, verifyPassword, createSession, readSession,
  sessionCookie, clearCookie, safeNext, redirect,
} from "./auth.js";

// A throwaway hash so a failed lookup costs the same time as a failed password.
const DECOY = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/login") return login(request, env);
    if (path === "/api/logout") return redirect("/", { "Set-Cookie": clearCookie() });
    if (path === "/api/me") return me(request, env);
    if (path.startsWith("/api/")) return new Response("Not found", { status: 404 });

    if (path === "/department" || path.startsWith("/department/")) return gate(request, env, path);

    return env.ASSETS.fetch(request);
  },
};

async function login(request, env) {
  if (request.method !== "POST") return redirect("/login/");
  const form = await request.formData();
  const user = String(form.get("user") || "").trim().toLowerCase();
  const pass = String(form.get("pass") || "");
  const next = safeNext(form.get("next"));

  const members = getMembers(env);
  if (!members) return redirect("/login/?error=config");

  const member = members[user];
  const ok = member ? await verifyPassword(pass, member.hash) : (await verifyPassword(pass, DECOY), false);
  if (!ok) return redirect(`/login/?error=1&next=${encodeURIComponent(next)}`);

  const token = await createSession(member, user, env.SESSION_SECRET);
  return redirect(next, { "Set-Cookie": sessionCookie(token) });
}

async function me(request, env) {
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json({ user: session.u, name: session.n, role: session.r }, { headers: { "Cache-Control": "no-store" } });
}

async function gate(request, env, path) {
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) return redirect(`/login/?next=${encodeURIComponent(path)}`);
  const asset = await env.ASSETS.fetch(request);
  const out = new Response(asset.body, asset);
  out.headers.set("Cache-Control", "private, no-store");
  out.headers.set("X-Robots-Tag", "noindex");
  return out;
}
