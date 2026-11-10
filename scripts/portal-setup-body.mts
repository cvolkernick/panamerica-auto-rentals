import { encodeDerived, derivePortalKey, passwordAcceptable } from "../lib/portal/derive";
import { normalizeLoginEmail } from "../lib/portal/email";

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  }
  process.stderr.write("Password: ");
  return await new Promise((resolve, reject) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let password = "";
    const onData = (buf: Buffer) => {
      const text = buf.toString("utf8");
      for (const char of text) {
        if (char === "\u0003") {
          stdin.setRawMode(false);
          stdin.pause();
          reject(new Error("cancelled"));
          return;
        }
        if (char === "\n" || char === "\r" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          resolve(password);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          password = password.slice(0, -1);
          continue;
        }
        password += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const email = normalizeLoginEmail(process.argv[2] ?? "");
  if (!email) {
    process.stderr.write(
      "Usage: npx tsx scripts/portal-setup-body.mts <email>\nThe password is read from stdin and is not echoed on a terminal.\n"
    );
    process.exitCode = 1;
    return;
  }
  const password = await readPassword();
  if (!passwordAcceptable(password)) {
    process.stderr.write("The password must be 12 to 128 characters.\n");
    process.exitCode = 1;
    return;
  }
  const derived = encodeDerived(await derivePortalKey(email, password));
  process.stdout.write(JSON.stringify({ email, derived }));
}

main().catch(() => {
  process.stderr.write("Could not build the setup body.\n");
  process.exitCode = 1;
});
