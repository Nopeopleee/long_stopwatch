import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  webcrypto, generateKeyPairSync, createHash, randomBytes,
  createHmac, createDecipheriv, verify
} from "node:crypto";
import worker from "../src/worker.js";
import {
  allowedPushEndpoint, decodeUrlBase64, encodeUrlBase64,
  pushConfigured, encryptPushPayload, sendWebPush
} from "../src/web-push.js";
import { runDuePushReminders, validSubscription } from "../src/push-reminders.js";

globalThis.crypto ??= webcrypto;
const HOUR = 3600000;
const origin = "https://disui.noppl.cc";

function dbFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0001_create_pets.sql", "0002_auth_accounts.sql",
                      "0003_password_credentials.sql", "0004_push_subscriptions.sql"]) {
    sqlite.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
  }
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const prepareResult = args => ({
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { return { meta: { changes: statement.run(...args).changes } }; }
      });
      return { bind(...args) { return prepareResult(args); }, ...prepareResult([]) };
    }
  };
  return { sqlite, db };
}
function pair() {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwkPub = keys.publicKey.export({ format: "jwk" });
  const jwkPriv = keys.privateKey.export({ format: "jwk" });
  return {
    publicKey: encodeUrlBase64(Buffer.concat([
      Buffer.from([4]), Buffer.from(jwkPub.x, "base64url"), Buffer.from(jwkPub.y, "base64url")
    ])),
    privateKey: jwkPriv.d,
    publicKeyObject: keys.publicKey
  };
}
function env(db) {
  const vapid = pair();
  return {
    DB: db, ASSETS: { fetch: async () => new Response("static") },
    PUSH_VAPID_PUBLIC_KEY: vapid.publicKey,
    PUSH_VAPID_PRIVATE_KEY: vapid.privateKey,
    PUSH_VAPID_SUBJECT: "mailto:noreply@noppl.cc",
    publicKeyObject: vapid.publicKeyObject
  };
}
function userAndPet(sqlite, { userId = "user-one", email = "user@example.org",
                                fed = Date.now() - 13 * HOUR } = {}) {
  const now = Date.now();
  const token = createHash("sha256").update("test-session-" + userId).digest("hex");
  sqlite.prepare("INSERT INTO users (id,email,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run(userId, email, now, now, now);
  sqlite.prepare("INSERT INTO auth_sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), userId, now, now + HOUR);
  const petId = "123e4567-e89b-42d3-a456-" + (userId === "user-one" ? "426614174001" : "426614174002");
  sqlite.prepare(
    "INSERT INTO pets (id,name,created_at,origin,legacy_started_at,owner_token_hash,last_fed_at,feed_count,died_at,updated_at) VALUES (?,?,?,'native',NULL,?,?,0,NULL,?)"
  ).run(petId, "小滴", now - 5 * HOUR, "unused-hash-" + userId, fed, now);
  sqlite.prepare("INSERT INTO pet_owners (pet_id,user_id,linked_at) VALUES (?,?,?)").run(petId, userId, now);
  return { cookie: "disui_session=" + token, petId, userId };
}
async function browserSubscription() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const auth = randomBytes(16);
  return {
    payload: {
      endpoint: "https://fcm.googleapis.com/fcm/send/demo-device-123",
      keys: { p256dh: encodeUrlBase64(raw), auth: encodeUrlBase64(auth) }
    },
    secretKey: keys.privateKey,
    auth: new Uint8Array(auth),
    publicKey: raw
  };
}
async function api(env, path, { method = "POST", cookie, data, originHeader = true } = {}) {
  const response = await worker.fetch(new Request(origin + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" || !originHeader ? {} : { Origin: origin })
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  }), env);
  return { status: response.status, body: await response.json() };
}
function shaHmac(key, data) {
  return createHmac("sha256", Buffer.from(key)).update(Buffer.from(data)).digest();
}
function expand(prk, info, len) {
  return shaHmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, len);
}
async function decryptRfc8291(content, client, data) {
  const blob = Buffer.from(content);
  const salt = blob.subarray(0, 16);
  assert.equal(blob.readUInt32BE(16), 4096);
  const length = blob[20];
  assert.equal(length, 65);
  const ephemeralRaw = blob.subarray(21, 21 + length);
  const ephemeralPublic = await crypto.subtle.importKey(
    "raw", ephemeralRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: ephemeralPublic }, client.secretKey, 256));
  const keyPrk = shaHmac(client.auth, shared);
  const info = Buffer.concat([
    Buffer.from("WebPush: info\0"), Buffer.from(client.publicKey), ephemeralRaw
  ]);
  const ikm = expand(keyPrk, info, 32);
  const prk = shaHmac(salt, ikm);
  const cek = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const ciphertext = blob.subarray(21 + length);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  assert.equal(plaintext.at(-1), 2);
  assert.deepEqual(JSON.parse(plaintext.subarray(0, -1).toString("utf8")), data);
}

test("Only trusted HTTPS push providers are accepted (no arbitrary fetch/SSRF)", () => {
  for (const url of [
    "https://fcm.googleapis.com/fcm/send/1",
    "https://updates.push.services.mozilla.com/wpush/v2/1",
    "https://web.push.apple.com/Q/1",
    "https://foo.push.apple.com/Q/1",
    "https://wns2-db5p.notify.windows.com/?token=opaque-test-string"
  ]) assert.equal(allowedPushEndpoint(url), true, url);
  for (const url of [
    "http://fcm.googleapis.com/fcm/send/a",
    "https://fcm.googleapis.com.evil.example/fcm/send/a",
    "https://127.0.0.1/internal",
    "https://localhost/",
    "https://evil.example/send/1",
    "https://fcm.googleapis.com:8443/send/1",
    "https://fcm.googleapis.com/"
  ]) assert.equal(allowedPushEndpoint(url), false, url);
  assert.equal(validSubscription({ endpoint: "https://evil.example/", keys: {} }), false);
  assert.throws(() => decodeUrlBase64("invalid="));
});

test("VAPID JWT signature and RFC8291 encrypted payload interoperate with independent Node crypto", async () => {
  const e = env(null), client = await browserSubscription();
  assert.equal(pushConfigured(e), true);
  const sample = { title: "小滴餓了", body: "現在可以餵食了", tag: "disui-feeding" };
  const wire = await encryptPushPayload({
    endpoint: client.payload.endpoint, p256dh: client.payload.keys.p256dh,
    auth_secret: client.payload.keys.auth
  }, sample);
  await decryptRfc8291(wire, client, sample);
  const previous = globalThis.fetch;
  let pushes = 0;
  globalThis.fetch = async (url, init) => {
    pushes++;
    assert.equal(url, client.payload.endpoint);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers["Content-Encoding"], "aes128gcm");
    assert.equal(init.headers.TTL, "21600");
    const token = init.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
    assert.ok(token, "Push uses VAPID Authorization header");
    assert.equal(token[2], e.PUSH_VAPID_PUBLIC_KEY);
    const segments = token[1].split(".");
    assert.equal(segments.length, 3);
    assert.equal(verify("sha256", Buffer.from(segments.slice(0, 2).join(".")), {
      key: e.publicKeyObject, dsaEncoding: "ieee-p1363"
    }, Buffer.from(segments[2], "base64url")), true);
    const claims = JSON.parse(Buffer.from(segments[1], "base64url").toString());
    assert.equal(claims.aud, "https://fcm.googleapis.com");
    assert.equal(claims.sub, "mailto:noreply@noppl.cc");
    await decryptRfc8291(init.body, client, sample);
    return new Response(null, { status: 201 });
  };
  try {
    const status = await sendWebPush({
      endpoint: client.payload.endpoint,
      p256dh: client.payload.keys.p256dh,
      auth_secret: client.payload.keys.auth
    }, e, sample);
    assert.equal(status, 201);
    assert.equal(pushes, 1);
  } finally { globalThis.fetch = previous; }
});

test("Opt-in, same-origin auth, one reminder per feeding and expiry cleanup", async () => {
  const { db, sqlite } = dbFixture();
  const e = env(db);
  const client = await browserSubscription();
  const account = userAndPet(sqlite);
  const now = Date.now();
  const originalFetch = globalThis.fetch;
  const pushes = [];
  globalThis.fetch = async (url, init) => {
    pushes.push({ url, init });
    return new Response(null, { status: 201 });
  };
  try {
    const config = await api(e, "/api/push/config", { method: "GET" });
    assert.equal(config.status, 200);
    assert.equal(config.body.publicKey, e.PUSH_VAPID_PUBLIC_KEY);
    assert.ok(!JSON.stringify(config.body).includes(e.PUSH_VAPID_PRIVATE_KEY));
    assert.equal((await api(e, "/api/push/subscribe", { data: client.payload })).status, 401);
    assert.equal((await api(e, "/api/push/subscribe", {
      cookie: account.cookie, data: client.payload, originHeader: false
    })).status, 403);
    const invalid = structuredClone(client.payload);
    invalid.endpoint = "https://evil.example/push";
    assert.equal((await api(e, "/api/push/subscribe", { cookie: account.cookie, data: invalid })).status, 400);

    const first = await api(e, "/api/push/subscribe", { cookie: account.cookie, data: client.payload });
    assert.equal(first.status, 200);
    assert.equal(first.body.subscribed, true);
    assert.equal((await api(e, "/api/push/status", {
      cookie: account.cookie, data: { endpoint: client.payload.endpoint }
    })).body.subscribed, true);
    const sent = await runDuePushReminders(e, now);
    assert.equal(sent.sent, 1);
    assert.equal(pushes.length, 1);
    assert.equal((await runDuePushReminders(e, now + 15 * 60000)).sent, 0);
    assert.equal(pushes.length, 1);
    // Feeding restarts the cooldown and permits exactly one new reminder.
    sqlite.prepare("UPDATE pets SET last_fed_at=? WHERE id=?").run(now, account.petId);
    assert.equal((await runDuePushReminders(e, now + HOUR)).sent, 0);
    assert.equal((await runDuePushReminders(e, now + 12 * HOUR + 1)).sent, 1);
    assert.equal(pushes.length, 2);
    const stale = await api(e, "/api/push/unsubscribe", {
      cookie: account.cookie, data: { endpoint: client.payload.endpoint }
    });
    assert.equal(stale.body.subscribed, false);
    assert.equal((await runDuePushReminders(e, now + 20 * HOUR)).sent, 0);
    assert.equal((await api(e, "/api/push/status", {
      cookie: account.cookie, data: { endpoint: client.payload.endpoint }
    })).body.subscribed, false);
    assert.equal((await api(e, "/api/push/subscribe", { cookie: account.cookie, data: client.payload })).status, 200);
    globalThis.fetch = async () => new Response(null, { status: 410 });
    sqlite.prepare("UPDATE pets SET last_fed_at=? WHERE id=?").run(now + 19 * HOUR, account.petId);
    await runDuePushReminders(e, now + 32 * HOUR);
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM push_subscriptions").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("Retry delayed errors, device limit and account boundaries", async () => {
  const { db, sqlite } = dbFixture();
  const e = env(db);
  const alice = userAndPet(sqlite);
  const bob = userAndPet(sqlite, { userId: "user-two", email: "b@example.org" });
  const client = await browserSubscription();
  const first = await api(e, "/api/push/subscribe", { cookie: alice.cookie, data: client.payload });
  assert.equal(first.status, 200);
  assert.equal((await api(e, "/api/push/status", {
    cookie: bob.cookie, data: { endpoint: client.payload.endpoint }
  })).body.subscribed, false);
  const next = await api(e, "/api/push/subscribe", { cookie: bob.cookie, data: client.payload });
  assert.equal(next.status, 200);
  assert.equal((await api(e, "/api/push/status", {
    cookie: alice.cookie, data: { endpoint: client.payload.endpoint }
  })).body.subscribed, false);
  assert.equal((await api(e, "/api/push/unsubscribe", {
    cookie: alice.cookie, data: { endpoint: client.payload.endpoint }
  })).status, 200);
  assert.equal((await api(e, "/api/push/status", {
    cookie: bob.cookie, data: { endpoint: client.payload.endpoint }
  })).body.subscribed, true);

  const now = Date.now();
  const previousFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response(null, { status: attempts === 1 ? 500 : 201 });
  };
  try {
    assert.equal((await runDuePushReminders(e, now)).sent, 0);
    assert.equal(attempts, 1);
    assert.equal((await runDuePushReminders(e, now + 15 * 60000)).sent, 0);
    assert.equal(attempts, 1);
    assert.equal((await runDuePushReminders(e, now + 31 * 60000)).sent, 1);
    assert.equal(attempts, 2);
    // Browser subscriptions are individual devices but do not clone accounts.
    for (let i = 0; i < 4; i++) {
      const device = await browserSubscription();
      device.payload.endpoint += "-" + i;
      assert.equal((await api(e, "/api/push/subscribe", {
        cookie: bob.cookie, data: device.payload
      })).status, 200);
    }
    const tooMany = await browserSubscription();
    tooMany.payload.endpoint += "-too-many";
    assert.equal((await api(e, "/api/push/subscribe", {
      cookie: bob.cookie, data: tooMany.payload
    })).status, 409);
  } finally {
    globalThis.fetch = previousFetch;
    sqlite.close();
  }
});

test("Test push is user-only, rate-limited and independent of feeding cycle", async () => {
  const { db, sqlite } = dbFixture();
  const e = env(db);
  const alice = userAndPet(sqlite);
  const bob = userAndPet(sqlite, { userId: "user-two", email: "b@example.org" });
  const device = await browserSubscription();
  const original = globalThis.fetch;
  let delivered = 0;
  globalThis.fetch = async () => {
    delivered++;
    return new Response(null, { status: 201 });
  };
  try {
    assert.equal((await api(e, "/api/push/test", {
      cookie: alice.cookie, data: { endpoint: device.payload.endpoint }
    })).status, 404);
    assert.equal((await api(e, "/api/push/subscribe", {
      cookie: alice.cookie, data: device.payload
    })).status, 200);
    const invalidOrigin = await api(e, "/api/push/test", {
      cookie: alice.cookie, data: { endpoint: device.payload.endpoint }, originHeader: false
    });
    assert.equal(invalidOrigin.status, 403);
    assert.equal((await api(e, "/api/push/test", {
      cookie: bob.cookie, data: { endpoint: device.payload.endpoint }
    })).status, 404);
    const sent = await api(e, "/api/push/test", {
      cookie: alice.cookie, data: { endpoint: device.payload.endpoint }
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.sent, true);
    assert.equal(delivered, 1);
    const again = await api(e, "/api/push/test", {
      cookie: alice.cookie, data: { endpoint: device.payload.endpoint }
    });
    assert.equal(again.status, 429);
    assert.equal(delivered, 1);
    // Test notifications should not mark a feeding cycle as already notified.
    const stored = sqlite.prepare(
      "SELECT last_test_at, last_sent_feed_at FROM push_subscriptions"
    ).get();
    assert.ok(stored.last_test_at > 0);
    assert.equal(stored.last_sent_feed_at, null);
  } finally {
    globalThis.fetch = original;
    sqlite.close();
  }
});

test("Cron is wired into Worker and Service Worker visibly displays incoming push", () => {
  const wrangler = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(wrangler.triggers.crons, ["*/15 * * * *"]);
  const source = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(source.includes('self.addEventListener("push"'));
  assert.ok(source.includes("registration.showNotification("));
  assert.ok(source.includes('self.addEventListener("notificationclick"'));
  assert.ok(!source.includes("event.data.url"));
  const settings = readFileSync(new URL("../settings.html", import.meta.url), "utf8");
  assert.ok(settings.includes('id="pushToggle"'));
  assert.ok(settings.includes('id="pushTest"'));
  const client = readFileSync(new URL("../push-ui.js", import.meta.url), "utf8");
  assert.ok(client.includes('toggle.addEventListener("click"'));
  assert.ok(client.includes("Notification.requestPermission()"));
  assert.ok(client.includes('testButton?.addEventListener("click"'));
  assert.ok(settings.includes("滿 12 小時"));
});
