// Turn a password into the stored hash used in the MEMBERS secret.
//   npm run hash -- "the password"
// Prints a pbkdf2$… string. Paste it as the member's "hash" value.
import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash -- "the password"');
  process.exit(1);
}
const iterations = 100000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log(`pbkdf2$${iterations}$${b64url(salt)}$${b64url(hash)}`);
