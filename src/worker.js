// Only /api/* is dispatched to this Worker before Cloudflare static assets.
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

const encoder = new TextEncoder();

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validName(value) {
  return typeof value === "string" &&
    value.trim() === value &&
    [...value].length >= 1 &&
    [...value].length <= 32 &&
    !/[\\u0000-\\u001f\\u007f]/.test(value);
}

function publicPet(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    origin: row.origin,
    lastFedAt: row.last_fed_at,
    feedCount: row.feed_count,
    diedAt: row.died_at,
    updatedAt: row.updated_at,
  };
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(header);
  return match ? match[1].toLowerCase() : null;
}

async function createPet(request, db) {
  const type = request.headers.get("Content-Type") || "";
  if (!/^application\\/json(?:\\s*;|\\s*$)/i.test(type)) {
    return json({ error: "Content-Type must be application/json" }, 415);
  }
  // Bounded input so malformed or oversized requests cannot exhaust the Worker.
  if (Number(request.headers.get("Content-Length")) > 2048) {
    return json({ error: "Request too large" }, 413);
  }
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "Request too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "name") || !validName(body.name)) {
    return json({ error: "name must be 1–32 characters" }, 400);
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const ownerToken = newToken();
  const tokenHash = await sha256(ownerToken);
  await db.prepare(
    `INSERT INTO pets (id, name, created_at, origin, legacy_started_at,
      owner_token_hash, last_fed_at, feed_count, died_at, updated_at)
     VALUES (?, ?, ?, 'native', NULL, ?, ?, 0, NULL, ?)`
  ).bind(id, body.name, now, tokenHash, now, now).run();

  return json({
    pet: { id, name: body.name, createdAt: now, origin: "native", lastFedAt: now,
      feedCount: 0, diedAt: null, updatedAt: now },
    ownerToken,
  }, 201, { "Location": `/api/pets/${id}` });
}

async function getPet(request, db, id) {
  const token = bearerToken(request);
  if (!token) return json({ error: "Bearer token required" }, 401, {
    "WWW-Authenticate": "Bearer",
  });

  const tokenHash = await sha256(token);
  // Authorization and retrieval happen in one query. Do not disclose whether
  // a pet ID exists when the provided credential does not match.
  const pet = await db.prepare(
    `SELECT id, name, created_at, origin, last_fed_at, feed_count, died_at, updated_at
     FROM pets WHERE id = ? AND owner_token_hash = ? LIMIT 1`
  ).bind(id, tokenHash).first();
  return pet ? json({ pet: publicPet(pet) }) : json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (pathname === "/api/health") {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      }
      try {
        const table = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pets' LIMIT 1"
        ).first();
        return json({ ok: true, database: "connected", schemaReady: Boolean(table) });
      } catch (error) {
        console.error("D1 health check failed", error);
        return json({ ok: false, database: "unavailable" }, 503);
      }
    }

    const petId = /^\\/api\\/pets\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(pathname)?.[1];
    const collection = pathname === "/api/pets";
    if (!collection && !petId) return json({ error: "Not found" }, 404);
    const allow = collection ? "POST" : "GET";
    if (request.method !== allow) {
      return json({ error: "Method not allowed" }, 405, { Allow: allow });
    }

    try {
      if (collection) return await createPet(request, env.DB);
      return await getPet(request, env.DB, petId);
    } catch (error) {
      console.error("Pet API failed", error);
      return json({ error: "Service unavailable" }, 503);
    }
  },
};
