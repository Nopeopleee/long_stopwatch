// The static PWA is served by Cloudflare's asset layer. Only /api/* runs
// this Worker first; other missing asset paths retain normal 404 handling.
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

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      if (pathname !== "/api/health") {
        return json({ error: "Not found" }, 404);
      }
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      }

      try {
        // Check both the DB binding and whether the initial migration ran.
        // This endpoint is read-only; no pet data is created or synchronized.
        const table = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pets' LIMIT 1"
        ).first();
        return json({ ok: true, database: "connected", schemaReady: Boolean(table) });
      } catch (error) {
        console.error("D1 health check failed", error);
        return json({ ok: false, database: "unavailable" }, 503);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
