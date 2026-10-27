import { getMembers, verifyPassword, createSession, sessionCookie, safeNext, redirect } from "../_lib/auth.js";

// A throwaway hash so a failed lookup costs the same time as a failed password.
const DECOY = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function onRequestPost({ request, env }) {
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

export function onRequestGet() {
  return redirect("/login/");
}
