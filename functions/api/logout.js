import { clearCookie, redirect } from "../_lib/auth.js";

export function onRequest() {
  return redirect("/", { "Set-Cookie": clearCookie() });
}
