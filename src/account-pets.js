import { authJson, currentUser, requireOrigin } from "./auth.js";
const HOUR = 60 * 60 * 1000;
const COOLDOWN = 12 * HOUR;
const PET_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function toPublic(row) {
  return {
    id: row.id, name: row.name, origin: row.origin,
    createdAt: row.created_at,
    ...(row.origin === "legacy" ? { legacyStartedAt: row.legacy_started_at } : {}),
    lastFedAt: row.last_fed_at, feedCount: row.feed_count,
    diedAt: row.died_at, updatedAt: row.updated_at
  };
}
async function bodyJson(request) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("Content-Type") || "")) {
    throw Object.assign(new Error("Content-Type must be application/json"), { status: 415 });
  }
  if (Number(request.headers.get("Content-Length") || 0) > 2048) {
    throw Object.assign(new Error("Request too large"), { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > 2048) throw Object.assign(new Error("Request too large"), { status: 413 });
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
    return data;
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}
function validName(name) {
  return typeof name === "string" && name === name.trim() &&
    [...name].length >= 1 && [...name].length <= 32 &&
    !/[\u0000-\u001f\u007f]/.test(name);
}
async function fetchOwned(db, userId) {
  return db.prepare(
    `SELECT pets.id, pets.name, pets.origin, pets.created_at, pets.legacy_started_at,
            pets.last_fed_at, pets.feed_count, pets.died_at, pets.updated_at
     FROM pet_owners JOIN pets ON pets.id = pet_owners.pet_id
     WHERE pet_owners.user_id = ? LIMIT 1`
  ).bind(userId).first();
}
async function digest(value) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(data)].map(x => x.toString(16).padStart(2, "0")).join("");
}

export async function handleAccountPet(request, env, pathname) {
  const db = env.DB;
  try {
    const user = await currentUser(request, db);
    if (!user) return authJson({ error: "請先登入" }, 401);
    if (request.method !== "GET") {
      const wrongOrigin = requireOrigin(request);
      if (wrongOrigin) return wrongOrigin;
    }
    if (pathname === "/api/me/pet" && request.method === "GET") {
      const pet = await fetchOwned(db, user.id);
      return authJson({ pet: pet ? toPublic(pet) : null });
    }
    if (pathname === "/api/me/pet" && request.method === "POST") {
      const body = await bodyJson(request);
      if (Object.keys(body).some(key => key !== "name") || !validName(body.name)) {
        return authJson({ error: "寵物名稱需要 1–32 個字" }, 400);
      }
      if (await fetchOwned(db, user.id)) return authJson({ error: "此帳號已擁有一隻滴歲" }, 409);
      const now = Date.now();
      const id = crypto.randomUUID();
      // Existing pets schema requires owner_token_hash; account-only pets never expose the token.
      const unusedToken = crypto.getRandomValues(new Uint8Array(32));
      const hash = await digest([...unusedToken].map(x => x.toString(16).padStart(2, "0")).join(""));
      await db.batch([
        db.prepare(
          `INSERT INTO pets (id, name, created_at, origin, legacy_started_at,
           owner_token_hash, last_fed_at, feed_count, died_at, updated_at)
           VALUES (?, ?, ?, 'native', NULL, ?, ?, 0, NULL, ?)`
        ).bind(id, body.name, now, hash, now, now),
        db.prepare("INSERT INTO pet_owners (pet_id, user_id, linked_at) VALUES (?, ?, ?)")
          .bind(id, user.id, now)
      ]);
      return authJson({ pet: { id, name: body.name, createdAt: now, origin: "native",
        lastFedAt: now, feedCount: 0, diedAt: null, updatedAt: now } }, 201);
    }
    if (pathname === "/api/me/pet/claim" && request.method === "POST") {
      const body = await bodyJson(request);
      if (!PET_ID.test(body.id || "") || typeof body.ownerToken !== "string" ||
          !/^[a-f0-9]{64}$/i.test(body.ownerToken)) {
        return authJson({ error: "寵物 ID 或持有者密鑰格式錯誤" }, 400);
      }
      if (await fetchOwned(db, user.id)) return authJson({ error: "此帳號已擁有一隻滴歲" }, 409);
      const hash = await digest(body.ownerToken.toLowerCase());
      const pet = await db.prepare(
        "SELECT id FROM pets WHERE id=? AND owner_token_hash=? LIMIT 1"
      ).bind(body.id.toLowerCase(), hash).first();
      if (!pet) return authJson({ error: "密鑰無效或寵物不存在" }, 404);
      const now = Date.now();
      const rotatedBytes = crypto.getRandomValues(new Uint8Array(32));
      const newHash = await digest([...rotatedBytes].map(x => x.toString(16).padStart(2, "0")).join(""));
      const results = await db.batch([
        db.prepare(
          `INSERT OR IGNORE INTO pet_owners (pet_id, user_id, linked_at)
           SELECT id, ?, ? FROM pets WHERE id=? AND owner_token_hash=?`
        ).bind(user.id, now, pet.id, hash),
        db.prepare(
          `UPDATE pets SET owner_token_hash=?, updated_at=?
           WHERE id=? AND owner_token_hash=? AND
             EXISTS(SELECT 1 FROM pet_owners WHERE pet_id=? AND user_id=?)`
        ).bind(newHash, now, pet.id, hash, pet.id, user.id)
      ]);
      if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
        return authJson({ error: "此寵物已被綁定或認領發生衝突" }, 409);
      }
      return authJson({ pet: toPublic(await fetchOwned(db, user.id)) });
    }
    if (pathname === "/api/me/pet/feed" && request.method === "POST") {
      const now = Date.now();
      const result = await db.prepare(
        `UPDATE pets SET last_fed_at=?, feed_count=feed_count+1, updated_at=?
         WHERE died_at IS NULL AND last_fed_at <= ?
           AND id IN (SELECT pet_id FROM pet_owners WHERE user_id=?)`
      ).bind(now, now, now - COOLDOWN, user.id).run();
      const pet = await fetchOwned(db, user.id);
      if (!pet) return authJson({ error: "尚未建立帳號寵物" }, 404);
      if (result.meta.changes !== 1) {
        return authJson({ error: "還沒到餵食時間", pet: toPublic(pet),
          nextFeedAt: pet.last_fed_at + COOLDOWN }, 409);
      }
      return authJson({ pet: toPublic(pet), nextFeedAt: now + COOLDOWN });
    }
    if (pathname === "/api/me/pet/rename" && request.method === "POST") {
      const body = await bodyJson(request);
      if (Object.keys(body).some(key => key !== "name") || !validName(body.name)) {
        return authJson({ error: "寵物名稱需要 1–32 個字" }, 400);
      }
      const result = await db.prepare(
        "UPDATE pets SET name=?, updated_at=? WHERE id IN (SELECT pet_id FROM pet_owners WHERE user_id=?)"
      ).bind(body.name, Date.now(), user.id).run();
      if (result.meta.changes !== 1) return authJson({ error: "尚未建立帳號寵物" }, 404);
      return authJson({ pet: toPublic(await fetchOwned(db, user.id)) });
    }
    return authJson({ error: "Not found" }, 404);
  } catch (error) {
    if (error.status) return authJson({ error: error.message }, error.status);
    console.error("Account pet API failed", error);
    return authJson({ error: "服務暫時無法使用" }, 503);
  }
}
