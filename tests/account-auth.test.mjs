import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";
import worker from "../src/worker.js";

globalThis.crypto ??= webcrypto;

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0001_create_pets.sql", "0002_auth_accounts.sql"]) {
    sqlite.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
  }
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            async first() { return stmt.get(...values) || null; },
            async all() { return { results: stmt.all(...values) }; },
            async run() { return { meta: { changes: stmt.run(...values).changes } }; }
          };
        },
        async first() { return stmt.get() || null; },
        async all() { return { results: stmt.all() }; },
        async run() { return { meta: { changes: stmt.run().changes } }; }
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return { db, sqlite };
}

const inbox = [];
function mockMailAndGoogle(jwks = { keys: [] }) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify(jwks), { status: 200 });
    }
    if (url === "https://api.resend.com/emails") {
      inbox.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "sent" }), { status: 200 });
    }
    throw Error("Unexpected network call: " + url);
  };
  return () => { globalThis.fetch = previous; };
}

function env(db) {
  return { DB: db, GOOGLE_CLIENT_ID: "testing-client-id",
    RESEND_API_KEY: "test-key", EMAIL_FROM: "滴歲 <hello@example.org>",
    APP_ORIGIN: "https://disui.noppl.cc",
    ASSETS: { fetch: () => new Response("static") } };
}
async function api(e, path, { method = "GET", body, cookie, origin = true } = {}) {
  const response = await worker.fetch(new Request("https://disui.noppl.cc" + path, {
    method, headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin && method !== "GET" ? { Origin: "https://disui.noppl.cc" } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  }), e);
  return { status: response.status, data: await response.json(),
    cookie: response.headers.get("Set-Cookie")?.split(";")[0] };
}
function linkToken(kind) {
  const mail = inbox.at(-1);
  assert.ok(mail, "Verification email was sent");
  const url = mail.text.match(new RegExp("https://disui\\.noppl\\.cc/settings\\?" + kind + "=([a-f0-9]{64})"));
  assert.ok(url, "Email contains a single-use verification URL");
  return url[1];
}
async function signup(e, address = "me@example.org", pass = "correct-horse-battery-42") {
  const registered = await api(e, "/api/auth/register", {
    method: "POST", body: { email: address, password: pass }
  });
  assert.equal(registered.status, 202);
  const verification = await api(e, "/api/auth/verify", {
    method: "POST", body: { token: linkToken("verify") }
  });
  assert.equal(verification.status, 200);
  assert.ok(verification.cookie?.startsWith("disui_session="));
  return { cookie: verification.cookie, address, pass };
}

test("Email verify, login, signed-in pet lifecycle, cooldown, logout", async () => {
  inbox.length = 0;
  const restoreFetch = mockMailAndGoogle();
  const { db, sqlite } = database();
  try {
    const e = env(db);
    const badOrigin = await api(e, "/api/auth/register", {
      method: "POST", body: { email: "e@example.org", password: "correct-pass-42" }, origin: false
    });
    assert.equal(badOrigin.status, 403);
    const reg = await api(e, "/api/auth/register", {
      method: "POST", body: { email: "me@example.org", password: "correct-horse-battery-42" }
    });
    assert.equal(reg.status, 202);
    assert.equal((await api(e, "/api/auth/login", {
      method: "POST", body: { email: "me@example.org", password: "correct-horse-battery-42" }
    })).status, 403);
    const verified = await api(e, "/api/auth/verify", {
      method: "POST", body: { token: linkToken("verify") }
    });
    assert.equal(verified.status, 200);
    const cookie = verified.cookie;
    assert.ok(cookie);
    const profile = await api(e, "/api/auth/me", { cookie });
    assert.equal(profile.data.user.emailVerified, true);
    assert.equal(profile.data.user.hasPassword, true);
    const login = await api(e, "/api/auth/login", {
      method: "POST", body: { email: "me@example.org", password: "correct-horse-battery-42" }
    });
    assert.equal(login.status, 200);
    const created = await api(e, "/api/me/pet", { method: "POST", cookie, body: { name: "滴歲" } });
    assert.equal(created.status, 201);
    assert.equal(created.data.pet.origin, "native");
    assert.equal((await api(e, "/api/me/pet", { cookie })).data.pet.id, created.data.pet.id);
    assert.equal((await api(e, "/api/me/pet", { method: "POST", cookie,
      body: { name: "another" } })).status, 409);
    assert.equal((await api(e, "/api/me/pet/feed", { method: "POST", cookie, body: {} })).status, 409);
    sqlite.prepare("UPDATE pets SET last_fed_at = ? WHERE id = ?").run(Date.now() - 13 * 3600_000, created.data.pet.id);
    const fed = await api(e, "/api/me/pet/feed", { method: "POST", cookie, body: {} });
    assert.equal(fed.status, 200);
    assert.equal(fed.data.pet.feedCount, 1);
    assert.equal((await api(e, "/api/me/pet/feed", { method: "POST", cookie, body: {} })).status, 409);
    const renamed = await api(e, "/api/me/pet/rename", {
      method: "POST", cookie, body: { name: "小滴" }
    });
    assert.equal(renamed.data.pet.name, "小滴");
    assert.equal((await api(e, "/api/auth/logout", { method: "POST", cookie, body: {} })).status, 200);
    assert.equal((await api(e, "/api/me/pet", { cookie })).status, 401);
  } finally { sqlite.close(); restoreFetch(); }
});

test("Google JWKS signature checked; manual linking prevents silent email merge", async () => {
  const pair = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const restoreFetch = mockMailAndGoogle({ keys: [{ ...pub, kid: "key-1", alg: "RS256", use: "sig" }] });
  const { db, sqlite } = database();
  try {
    const e = env(db);
    function base64url(bytes) {
      return Buffer.from(bytes).toString("base64url");
    }
    async function idToken(overrides = {}) {
      const h = base64url(Buffer.from(JSON.stringify({ alg: "RS256", kid: "key-1", typ: "JWT" })));
      const now = Math.floor(Date.now() / 1000);
      const p = base64url(Buffer.from(JSON.stringify({
        sub: "1122334455667788", email: "google@example.org", email_verified: true,
        aud: e.GOOGLE_CLIENT_ID, iss: "https://accounts.google.com", iat: now, exp: now + 1200,
        ...overrides
      })));
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(h + "." + p));
      return h + "." + p + "." + base64url(new Uint8Array(sig));
    }
    assert.equal((await api(e, "/api/auth/google", {
      method: "POST", body: { credential: await idToken({ aud: "malicious-client" }) }
    })).status, 401);
    const google = await api(e, "/api/auth/google", {
      method: "POST", body: { credential: await idToken() }
    });
    assert.equal(google.status, 200);
    assert.equal(google.data.user.googleLinked, true);
    assert.equal(google.data.user.hasPassword, false);
    const repeat = await api(e, "/api/auth/google", {
      method: "POST", body: { credential: await idToken() }
    });
    assert.equal(repeat.data.user.id, google.data.user.id);
  } finally { sqlite.close(); restoreFetch(); }
});

test("Password reset revokes sessions; claim requires existing owner token", async () => {
  inbox.length = 0;
  const restoreFetch = mockMailAndGoogle();
  const { db, sqlite } = database();
  try {
    const e = env(db);
    const session = await signup(e, "claim@example.org", "original-password-11");
    const created = await api(e, "/api/pets", {
      method: "POST", body: { name: "舊的小滴" }
    });
    assert.equal(created.status, 201);
    const claim = await api(e, "/api/me/pet/claim", {
      method: "POST", cookie: session.cookie,
      body: { id: created.data.pet.id, ownerToken: created.data.ownerToken }
    });
    assert.equal(claim.status, 200);
    const oldPet = await worker.fetch(new Request(
      "https://disui.noppl.cc/api/pets/" + created.data.pet.id,
      { headers: { Authorization: "Bearer " + created.data.ownerToken } }
    ), e);
    assert.equal(oldPet.status, 404);
    assert.equal((await api(e, "/api/auth/forgot-password", {
      method: "POST", body: { email: session.address }
    })).status, 202);
    const token = linkToken("reset");
    assert.equal((await api(e, "/api/auth/reset-password", {
      method: "POST", body: { token, password: "new-password-42-strong" }
    })).status, 200);
    assert.equal((await api(e, "/api/me/pet", { cookie: session.cookie })).status, 401);
    assert.equal((await api(e, "/api/auth/reset-password", {
      method: "POST", body: { token, password: "another-password-44" }
    })).status, 400);
    const newLogin = await api(e, "/api/auth/login", {
      method: "POST", body: { email: session.address, password: "new-password-42-strong" }
    });
    assert.equal(newLogin.status, 200);
    assert.equal((await api(e, "/api/me/pet", { cookie: newLogin.cookie })).data.pet.id, created.data.pet.id);
  } finally { sqlite.close(); restoreFetch(); }
});

test("Auth config reports whether D1 account migration was applied", async () => {
  const { db, sqlite } = database();
  try {
    const e = env(db);
    const ready = await api(e, "/api/auth/config");
    assert.equal(ready.status, 200);
    assert.equal(ready.data.authSchemaReady, true);
    assert.equal(ready.data.emailEnabled, true);
    sqlite.exec("DROP TABLE auth_rate_limits");
    const missing = await api(e, "/api/auth/config");
    assert.equal(missing.status, 200);
    assert.equal(missing.data.authSchemaReady, false);
  } finally {
    sqlite.close();
  }
});

test("Retry signup can resend verification after initial delivery error", async () => {
  inbox.length = 0;
  const { db, sqlite } = database();
  const e = env(db);
  let broken = true;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url !== "https://api.resend.com/emails") throw Error("Unexpected service");
    if (broken) return new Response(JSON.stringify({ message: "sender not verified" }), { status: 403 });
    inbox.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: "sent" }), { status: 200 });
  };
  try {
    const body = { email: "retry@example.org", password: "correct-horse-battery-42" };
    const first = await api(e, "/api/auth/register", { method: "POST", body });
    assert.equal(first.status, 502);
    assert.equal(first.data.code, "EMAIL_DELIVERY_FAILED");
    const row = sqlite.prepare("SELECT id FROM users WHERE email=?").get(body.email);
    assert.ok(row, "Signup should have persisted pending account");
    sqlite.prepare("UPDATE auth_tokens SET created_at = ? WHERE user_id=?").run(Date.now() - 61_000, row.id);
    broken = false;
    const second = await api(e, "/api/auth/register", { method: "POST", body });
    assert.equal(second.status, 202);
    assert.equal(inbox.length, 1);
    const verified = await api(e, "/api/auth/verify", { method: "POST", body: { token: linkToken("verify") } });
    assert.equal(verified.status, 200);
  } finally {
    globalThis.fetch = oldFetch;
    sqlite.close();
  }
});
