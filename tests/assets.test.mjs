import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Cloudflare assets include all scripts, styles, and PWA cached files", () => {
  const allowed = read(".assetsignore").split(/\r?\n/).filter(x => x.startsWith("!")).map(x => x.slice(1));
  const sw = read("sw.js");
  const html = [read("index.html"), read("settings.html")].join("\n");
  for (const asset of ["account.js", "account-ui.js", "account.css", "cloud.js", "app.js", "settings.js"]) {
    assert.ok(allowed.includes(asset), asset + " missing from Cloudflare static asset allowlist");
    const version = asset === "account-ui.js" ? "auth-v2" : "auth-v1";
    assert.ok(sw.includes("./" + asset + "?v=" + version), asset + " missing from PWA cache with updated version");
    assert.ok(html.includes("./" + asset + "?v=" + version), asset + " missing from HTML scripts/styles");
  }
});

test("Every account settings control referenced by account-ui.js exists in HTML", () => {
  const html = read("settings.html");
  const script = read("account-ui.js");
  const ids = [...script.matchAll(/\$\("([A-Za-z][A-Za-z0-9]*)"\)/g)].map(x => x[1]);
  for (const id of ids) assert.ok(html.includes('id="' + id + '"'), "Missing account UI id " + id);
  assert.ok(html.includes('meta name="referrer" content="no-referrer"'));
});

test("D1 migrations remain append-only", () => {
  assert.ok(read("migrations/0001_create_pets.sql").includes("CREATE TABLE IF NOT EXISTS pets"));
  const auth = read("migrations/0002_auth_accounts.sql");
  for (const name of ["users", "auth_identities", "auth_sessions", "auth_tokens", "pet_owners", "auth_rate_limits"]) {
    assert.ok(auth.includes("CREATE TABLE IF NOT EXISTS " + name), "Missing " + name);
  }
});
