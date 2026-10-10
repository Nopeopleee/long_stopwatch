import { authJson, currentUser, requireOrigin } from "./auth.js";
import { allowedPushEndpoint, decodeUrlBase64, pushConfigured, sendWebPush } from "./web-push.js";

const FEED_COOLDOWN = 12 * 60 * 60 * 1000;
const RETRY_AFTER = 30 * 60 * 1000;
const PER_USER_DEVICES = 5;
const BATCH_LIMIT = 10;

async function parseBody(request) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("Content-Type") || "")) {
    throw Object.assign(new Error("請重新整理後再試"), { status: 415 });
  }
  if (Number(request.headers.get("Content-Length") || 0) > 3500) {
    throw Object.assign(new Error("資料過大"), { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > 3500) throw Object.assign(new Error("資料過大"), { status: 413 });
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw Object.assign(new Error("通知資料格式不正確"), { status: 400 });
  }
}

export function validSubscription(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["endpoint", "keys"].includes(key)) ||
      !allowedPushEndpoint(value.endpoint) ||
      !value.keys || typeof value.keys !== "object" || Array.isArray(value.keys) ||
      Object.keys(value.keys).some(key => !["p256dh", "auth"].includes(key))) return false;
  try {
    const publicKey = decodeUrlBase64(value.keys.p256dh);
    return publicKey.length === 65 && publicKey[0] === 4 && decodeUrlBase64(value.keys.auth).length === 16;
  } catch { return false; }
}

export async function handlePushApi(request, env, path) {
  try {
    if (path === "/api/push/config" && request.method === "GET") {
      return authJson({
        available: pushConfigured(env),
        publicKey: pushConfigured(env) ? env.PUSH_VAPID_PUBLIC_KEY : null
      });
    }
    const user = await currentUser(request, env.DB);
    if (!user) return authJson({ error: "請先登入才能開啟餵食提醒" }, 401);
    if (request.method !== "POST") return authJson({ error: "Method not allowed" }, 405);
    const wrongOrigin = requireOrigin(request);
    if (wrongOrigin) return wrongOrigin;
    const input = await parseBody(request);
    if (path === "/api/push/status") {
      if (!allowedPushEndpoint(input.endpoint)) return authJson({ subscribed: false });
      const record = await env.DB.prepare(
        "SELECT enabled FROM push_subscriptions WHERE user_id = ? AND endpoint = ?"
      ).bind(user.id, input.endpoint).first();
      return authJson({ subscribed: record?.enabled === 1 });
    }
    if (path === "/api/push/subscribe") {
      if (!pushConfigured(env)) return authJson({ error: "提醒功能尚未開放" }, 503);
      if (!validSubscription(input)) return authJson({ error: "無法確認裝置通知設定，請重新開啟通知" }, 400);
      const already = await env.DB.prepare(
        "SELECT user_id FROM push_subscriptions WHERE endpoint = ?"
      ).bind(input.endpoint).first();
      if (!already || already.user_id !== user.id) {
        const count = await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?"
        ).bind(user.id).first();
        if (count.count >= PER_USER_DEVICES) {
          return authJson({ error: "最多能在 5 台裝置開啟提醒，請先在其他裝置關閉" }, 409);
        }
      }
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO push_subscriptions
          (endpoint, user_id, p256dh, auth_secret, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id=excluded.user_id, p256dh=excluded.p256dh, auth_secret=excluded.auth_secret,
           enabled=1, updated_at=excluded.updated_at,
           last_attempt_feed_at=NULL, last_attempt_at=NULL, last_sent_feed_at=NULL`
      ).bind(input.endpoint, user.id, input.keys.p256dh, input.keys.auth, now, now).run();
      return authJson({ subscribed: true });
    }
    if (path === "/api/push/test") {
      if (!pushConfigured(env)) return authJson({ error: "通知功能暫時無法使用" }, 503);
      if (!allowedPushEndpoint(input.endpoint)) return authJson({ error: "裝置通知資料無效" }, 400);
      const now = Date.now();
      // At most one test alert per two minutes per account-owned device.
      const claimed = await env.DB.prepare(
        `UPDATE push_subscriptions SET last_test_at=?
         WHERE endpoint=? AND user_id=? AND enabled=1
           AND (last_test_at IS NULL OR last_test_at <= ?)`
      ).bind(now, input.endpoint, user.id, now - 2 * 60 * 1000).run();
      if (claimed.meta.changes !== 1) {
        const record = await env.DB.prepare(
          "SELECT last_test_at FROM push_subscriptions WHERE endpoint=? AND user_id=? AND enabled=1"
        ).bind(input.endpoint, user.id).first();
        return record
          ? authJson({ error: "剛剛已送過測試通知，請兩分鐘後再試" }, 429)
          : authJson({ error: "請先在這台裝置開啟提醒" }, 404);
      }
      const sub = await env.DB.prepare(
        "SELECT p256dh, auth_secret FROM push_subscriptions WHERE endpoint=? AND user_id=?"
      ).bind(input.endpoint, user.id).first();
      const status = await sendWebPush({
        endpoint: input.endpoint, p256dh: sub.p256dh, auth_secret: sub.auth_secret
      }, env, {
        title: "滴歲的通知測試 💧",
        body: "這台裝置已經準備好接收小滴的餵食提醒！",
        tag: "disui-feeding",
        url: "/"
      }, now);
      if (status === 404 || status === 410) {
        await env.DB.prepare(
          "DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?"
        ).bind(input.endpoint, user.id).run();
        return authJson({ error: "裝置的提醒設定已失效，請重新開啟" }, 410);
      }
      if (status < 200 || status >= 300) return authJson({ error: "測試通知未能送出，請稍後再試" }, 502);
      return authJson({ sent: true });
    }
    if (path === "/api/push/unsubscribe") {
      if (!allowedPushEndpoint(input.endpoint)) return authJson({ error: "通知資料格式不正確" }, 400);
      await env.DB.prepare(
        "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?"
      ).bind(user.id, input.endpoint).run();
      return authJson({ subscribed: false });
    }
    return authJson({ error: "Not found" }, 404);
  } catch (error) {
    if (error.status) return authJson({ error: error.message }, error.status);
    console.error("Push API failed", error);
    return authJson({ error: "通知服務暫時無法使用，請稍後再試" }, 503);
  }
}

export async function runDuePushReminders(env, now = Date.now()) {
  if (!pushConfigured(env)) return { sent: 0, checked: 0, disabled: true };
  // Each device is reminded at most once per feeding cycle; failed network
  // attempts may retry after 30 minutes. No repeated nagging while hungry.
  const rows = await env.DB.prepare(
    `SELECT s.endpoint, s.user_id, s.p256dh, s.auth_secret,
            p.name AS pet_name, p.last_fed_at AS feed_marker
     FROM push_subscriptions s
     JOIN pet_owners o ON o.user_id = s.user_id
     JOIN pets p ON p.id = o.pet_id
     WHERE s.enabled = 1 AND p.died_at IS NULL
       AND p.last_fed_at <= ?
       AND (s.last_sent_feed_at IS NULL OR s.last_sent_feed_at <> p.last_fed_at)
       AND (s.last_attempt_feed_at IS NULL OR s.last_attempt_feed_at <> p.last_fed_at
            OR s.last_attempt_at <= ?)
     ORDER BY s.updated_at ASC LIMIT ?`
  ).bind(now - FEED_COOLDOWN, now - RETRY_AFTER, BATCH_LIMIT).all();

  let sent = 0;
  for (const row of rows.results) {
    // Claim before making an external request; prevents overlapping Cron runs
    // from sending the same reminder simultaneously.
    const claim = await env.DB.prepare(
      `UPDATE push_subscriptions SET last_attempt_feed_at=?, last_attempt_at=?
       WHERE endpoint=? AND user_id=? AND enabled=1
         AND (last_sent_feed_at IS NULL OR last_sent_feed_at <> ?)
         AND (last_attempt_feed_at IS NULL OR last_attempt_feed_at <> ? OR last_attempt_at <= ?)
         AND EXISTS (
           SELECT 1 FROM pet_owners o JOIN pets p ON p.id=o.pet_id
           WHERE o.user_id=? AND p.last_fed_at=? AND p.died_at IS NULL AND p.last_fed_at <= ?
         )`
    ).bind(
      row.feed_marker, now, row.endpoint, row.user_id,
      row.feed_marker, row.feed_marker, now - RETRY_AFTER,
      row.user_id, row.feed_marker, now - FEED_COOLDOWN
    ).run();
    if (claim.meta.changes !== 1) continue;
    try {
      const status = await sendWebPush({
        endpoint: row.endpoint, p256dh: row.p256dh, auth_secret: row.auth_secret
      }, env, {
        title: "小滴肚子餓了 💧",
        body: `可以餵食了，回來陪陪${row.pet_name}吧！`,
        tag: "disui-feeding",
        url: "/"
      }, now);
      if (status >= 200 && status < 300) {
        await env.DB.prepare(
          "UPDATE push_subscriptions SET last_sent_feed_at = ? WHERE endpoint=? AND user_id=? AND last_attempt_feed_at=? AND last_attempt_at=?"
        ).bind(row.feed_marker, row.endpoint, row.user_id, row.feed_marker, now).run();
        sent++;
      } else if (status === 404 || status === 410) {
        // Browser unsubscribed or push service expired the endpoint.
        await env.DB.prepare(
          "DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=? AND last_attempt_at=?"
        ).bind(row.endpoint, row.user_id, now).run();
      } else {
        console.warn("Push provider rejected notification, status:", status);
      }
    } catch (error) {
      // Don't log the endpoint, its keys, or the push message.
      console.warn("Push reminder delivery failed:", error?.name || "network");
    }
  }
  return { sent, checked: rows.results.length };
}
