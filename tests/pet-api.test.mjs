// Run with Node.js 22+: node --test tests/pet-api.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../src/worker.js";

globalThis.crypto ??= webcrypto;

class MemoryD1 {
  constructor() { this.pets = new Map(); }
  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes("sqlite_master")) return { name: "pets" };
            if (sql.includes("owner_token_hash")) {
              const [id, hash] = args;
              const row = db.pets.get(id);
              return row?.owner_token_hash === hash ? { ...row } : null;
            }
            return null;
          },
          async run() {
            if (sql.startsWith("INSERT")) {
              let pet;
              if (sql.includes("'legacy'")) {
                const [id, name, created, legacy, hash, fed, count, updated] = args;
                pet = { id, name, created_at: created, origin: "legacy", legacy_started_at: legacy,
                  owner_token_hash: hash, last_fed_at: fed, feed_count: count, died_at: null,
                  updated_at: updated };
              } else {
                const [id, name, created, hash, fed, updated] = args;
                pet = { id, name, created_at: created, origin: "native", legacy_started_at: null,
                  owner_token_hash: hash, last_fed_at: fed, feed_count: 0, died_at: null,
                  updated_at: updated };
              }
              db.pets.set(pet.id, pet);
              return { meta: { changes: 1 } };
            }
            if (sql.includes("feed_count = feed_count + 1")) {
              const [fed, updated, id, hash, before] = args;
              const row = db.pets.get(id);
              if (!row || row.owner_token_hash !== hash || row.died_at !== null ||
                  row.last_fed_at > before) return { meta: { changes: 0 } };
              row.last_fed_at = fed;
              row.updated_at = updated;
              row.feed_count++;
              return { meta: { changes: 1 } };
            }
            if (sql.includes("owner_token_hash = ?")) {
              const [newHash, updated, id, oldHash] = args;
              const row = db.pets.get(id);
              if (!row || row.owner_token_hash !== oldHash) return { meta: { changes: 0 } };
              row.owner_token_hash = newHash;
              row.updated_at = updated;
              return { meta: { changes: 1 } };
            }
            throw new Error("Unexpected SQL: " + sql);
          }
        };
      },
      async first() {
        return sql.includes("sqlite_master") ? { name: "pets" } : null;
      }
    };
  }
}

const env = () => ({ DB: new MemoryD1(), ASSETS: { fetch: () => new Response("asset") } });
async function call(e, path, { method = "GET", token, body } = {}) {
  const response = await worker.fetch(new Request("https://example.com" + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }), e);
  return { status: response.status, data: await response.json() };
}

test("create, authenticate, reject replayed feeds, rotate token", async () => {
  const e = env();
  const created = await call(e, "/api/pets", { method: "POST", body: { name: "滴歲" } });
  assert.equal(created.status, 201);
  const { id } = created.data.pet;
  const token = created.data.ownerToken;
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal((await call(e, "/api/pets/" + id)).status, 401);
  assert.equal((await call(e, "/api/pets/" + id, { token: "a".repeat(64) })).status, 404);
  assert.equal((await call(e, "/api/pets/" + id, { token })).status, 200);

  // Force eligibility instead of waiting 12 hours.
  e.DB.pets.get(id).last_fed_at -= 13 * 60 * 60 * 1000;
  const fed = await call(e, "/api/pets/" + id + "/feed", { method: "POST", token });
  assert.equal(fed.status, 200);
  assert.equal(fed.data.pet.feedCount, 1);
  assert.equal((await call(e, "/api/pets/" + id + "/feed", { method: "POST", token })).status, 409);

  const rotated = await call(e, "/api/pets/" + id + "/rotate-token", { method: "POST", token });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.data.ownerToken, token);
  assert.equal((await call(e, "/api/pets/" + id, { token })).status, 404);
  assert.equal((await call(e, "/api/pets/" + id, { token: rotated.data.ownerToken })).status, 200);
});

test("legacy import retains provenance and original birth timestamp", async () => {
  const e = env();
  const startedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
  const result = await call(e, "/api/pets/import", {
    method: "POST",
    body: { name: "老朋友", startedAt, lastFedAt: Date.now() - 15 * 60 * 60 * 1000, feedCount: 25 }
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.pet.origin, "legacy");
  const fetched = await call(e, "/api/pets/" + result.data.pet.id, { token: result.data.ownerToken });
  assert.equal(fetched.data.pet.legacyStartedAt, startedAt);
  assert.equal(fetched.data.pet.feedCount, 25);
  assert.equal((await call(e, "/api/pets/import", { method: "POST",
    body: { name: "X", startedAt: Date.now() + 100000, lastFedAt: Date.now(), feedCount: 0 }
  })).status, 400);
});
