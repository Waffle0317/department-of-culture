// Turn a password into the stored hash used in the MEMBERS secret.
//
//   npm run hash                      asks for the password (typing is hidden)
//   npm run hash -- "the password"    takes it from the command line
//
// Prints a pbkdf2$… string. Paste it as the member's "hash" value.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function hash(password) {
  const iterations = 100000;
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(key)}`;
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
const normalWrite = rl._writeToOutput;

// Queue typed lines so none is lost between prompts.
const lines = [];
const waiting = [];
rl.on("line", (l) => { const w = waiting.shift(); if (w) w(l); else lines.push(l); });
rl.on("close", () => { while (waiting.length) waiting.shift()(""); });
const nextLine = () => new Promise((r) => (lines.length ? r(lines.shift()) : waiting.push(r)));

async function askHidden(question) {
  process.stdout.write(question);
  rl._writeToOutput = () => {}; // hide what is typed
  const answer = await nextLine();
  rl._writeToOutput = normalWrite;
  process.stdout.write("\n");
  return answer.trim();
}

let password = process.argv[2];
if (!password) {
  password = await askHidden("Password to hash (typing is hidden): ");
  if (!password) {
    console.error("No password entered.");
    process.exit(1);
  }
  const again = await askHidden("Type it again to confirm: ");
  if (again !== password) {
    console.error("The two entries did not match. Nothing printed.");
    process.exit(1);
  }
}
rl.close();

console.log("\nPaste this as the hash value in MEMBERS:\n");
console.log(hash(password));
console.log("");
