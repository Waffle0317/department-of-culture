import { readSession } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json({ user: session.u, name: session.n, role: session.r }, { headers: { "Cache-Control": "no-store" } });
}
