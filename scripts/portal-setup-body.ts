import { encodeDerived, derivePortalKey, passwordAcceptable } from "../lib/portal/derive";
import { normalizeLoginEmail } from "../lib/portal/email";

const email = normalizeLoginEmail(process.argv[2] ?? "");
if (!email) {
  process.stderr.write("Usage: npx tsx scripts/portal-setup-body.ts <email>\nThe password is read from stdin.\n");
  process.exit(1);
}

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
if (!passwordAcceptable(password)) {
  process.stderr.write("The password must be 12 to 128 characters.\n");
  process.exit(1);
}

const derived = encodeDerived(await derivePortalKey(email, password));
process.stdout.write(JSON.stringify({ email, derived }));
