// Runs as the "postbuild" npm script, right after `next build`. Scans every
// JS file Next.js actually ships to the browser (.next/static) for the
// literal names of server-only secrets. Finding either string there means
// some code that referenced it got bundled for the client — a real leak,
// not a false positive, since neither name has any legitimate reason to
// appear in browser-shipped source.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"];
const CLIENT_DIR = join(process.cwd(), ".next", "static");

function collectJsFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      collectJsFiles(full, files);
    } else if (entry.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

if (!existsSync(CLIENT_DIR)) {
  console.error(`check-client-bundle: expected ${CLIENT_DIR} to exist after \`next build\`.`);
  process.exit(1);
}

const files = collectJsFiles(CLIENT_DIR);
let leaked = false;

for (const file of files) {
  const contents = readFileSync(file, "utf8");
  for (const name of FORBIDDEN_NAMES) {
    if (contents.includes(name)) {
      console.error(`check-client-bundle: found "${name}" in client bundle file ${file}`);
      leaked = true;
    }
  }
}

if (leaked) {
  console.error(
    `\ncheck-client-bundle: scanned ${files.length} file(s) under .next/static — a server-only env var name leaked into browser code. See the file(s) above.`,
  );
  process.exit(1);
}

console.log(`check-client-bundle: OK — scanned ${files.length} client bundle file(s), no forbidden env var names found.`);
