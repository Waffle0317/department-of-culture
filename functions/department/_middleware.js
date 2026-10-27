import { readSession, redirect } from "../_lib/auth.js";

// Everything under /department/ requires a valid session cookie.
export async function onRequest({ request, env, next }) {
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) {
    const url = new URL(request.url);
    return redirect(`/login/?next=${encodeURIComponent(url.pathname)}`);
  }
  const response = await next();
  const out = new Response(response.body, response);
  out.headers.set("Cache-Control", "private, no-store");
  out.headers.set("X-Robots-Tag", "noindex");
  return out;
}
