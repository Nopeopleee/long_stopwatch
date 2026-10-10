// Cloudflare Workers account authentication. Uses WebCrypto, D1 and Resend; no npm runtime dependencies.
const textEncoder = new TextEncoder();
// Production Workers reject PBKDF2 >100,000 iterations per deriveBits call.
// 45,000 is selected for Workers Free's 10ms CPU budget; require a secret pepper.
const ITERATIONS = 45000;
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_MS = 30 * 60 * 1000;
const RESET_TOKEN_MS = 20 * 60 * 1000;
const COOKIE = "disui_session";
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let googleKeyCache = { expires: 0, keys: [] };

export function authJson(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  } });
}

function token() {
  const buf = crypto.getRandomValues(new Uint8Array(32));
  return [...buf].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}
function passwordValid(value) {
  return typeof value === "string" && value.length >= 10 && value.length <= 128;
}
function passwordPepperReady(env) {
  return typeof env.AUTH_PASSWORD_PEPPER === "string" && env.AUTH_PASSWORD_PEPPER.length >= 32;
}
function validGoogleClientId(value) {
  // Client secrets typically start with GOCSPX- and must never be sent to browsers.
  return typeof value === "string" &&
    /^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(value);
}
async function passwordHash(password, salt, iterations, env) {
  if (!passwordPepperReady(env)) {
    throw Object.assign(new Error("Password pepper not configured"), { code: "PASSWORD_PEPPER_MISSING" });
  }
  if (!Number.isSafeInteger(iterations) || iterations < 10000 || iterations > 100000) {
    throw Object.assign(new Error("Unsupported PBKDF2 cost"), { code: "INVALID_PASSWORD_KDF" });
  }
  // The HMAC key is a high-entropy Worker secret, never stored in D1. Even with
  // a DB dump, the attacker cannot test candidate passwords offline without it.
  const hmacKey = await crypto.subtle.importKey(
    "raw", textEncoder.encode(env.AUTH_PASSWORD_PEPPER),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const prehash = await crypto.subtle.sign("HMAC", hmacKey, textEncoder.encode(password));
  const key = await crypto.subtle.importKey("raw", prehash, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", salt: Uint8Array.from(salt.match(/../g).map(x => parseInt(x, 16))),
    iterations, hash: "SHA-256"
  }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function hashNewPassword(password, env) {
  const salt = token().slice(0, 32);
  return { salt, iterations: ITERATIONS, hash: await passwordHash(password, salt, ITERATIONS, env) };
}
async function passwordMatches(password, user, env) {
  if (!user?.credential_hash || !passwordValid(password)) return false;
  const actual = await passwordHash(password, user.credential_salt, user.credential_iterations, env);
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ user.credential_hash.charCodeAt(i);
  return diff === 0 && actual.length === user.credential_hash.length;
}

function jsonBody(request, maxLength = 2048) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("Content-Type") || "")) {
    throw Object.assign(new Error("Content-Type must be application/json"), { status: 415 });
  }
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maxLength) throw Object.assign(new Error("Request too large"), { status: 413 });
  return request.text().then(raw => {
    if (raw.length > maxLength) throw Object.assign(new Error("Request too large"), { status: 413 });
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid");
      return data;
    } catch {
      throw Object.assign(new Error("Invalid JSON"), { status: 400 });
    }
  });
}

export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}
export function requireOrigin(request) {
  return sameOrigin(request) ? null : authJson({ error: "Cross-origin request rejected" }, 403);
}

async function limit(db, request, bucket, max, windowMs, identity = "") {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await digest(bucket + "|" + ip + "|" + identity);
  const now = Date.now();
  await db.prepare(
    `INSERT INTO auth_rate_limits (key, window_start, attempts) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END,
       window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END`
  ).bind(key, now, now - windowMs, now - windowMs).run();
  const current = await db.prepare("SELECT attempts FROM auth_rate_limits WHERE key = ?").bind(key).first();
  // Opportunistic cleanup to prevent unbounded growth.
  if (Math.random() < 0.01) {
    await db.prepare("DELETE FROM auth_rate_limits WHERE window_start < ?")
      .bind(now - 2 * 24 * 60 * 60 * 1000).run().catch(() => {});
  }
  return current.attempts <= max;
}

function cookieValue(request) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1) || "";
}
function setCookie(value, age = Math.floor(SESSION_MS / 1000)) {
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=${age}`;
}
export async function currentUser(request, db) {
  const value = cookieValue(request);
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  const hash = await digest(value);
  return db.prepare(
    `SELECT users.id, users.email, users.email_verified_at,
            EXISTS(SELECT 1 FROM auth_password_credentials WHERE user_id = users.id) AS has_password,
            EXISTS(SELECT 1 FROM auth_identities WHERE user_id = users.id AND provider = 'google') AS google_linked
     FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
     WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ? LIMIT 1`
  ).bind(hash, Date.now()).first();
}
function publicUser(user) {
  return {
    id: user.id, email: user.email, emailVerified: !!user.email_verified_at,
    hasPassword: !!user.has_password, googleLinked: !!user.google_linked
  };
}
async function issueSession(db, user) {
  const raw = token();
  const hash = await digest(raw);
  const now = Date.now();
  await db.prepare(
    "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(hash, user.id, now, now + SESSION_MS).run();
  return authJson({ user: publicUser(user) }, 200, { "Set-Cookie": setCookie(raw) });
}

async function sendEmail(env, to, kind, value) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw Object.assign(new Error("Email provider not configured"), { code: "EMAIL_NOT_CONFIGURED" });
  }
  const url = new URL("/settings", env.APP_ORIGIN || "https://disui.noppl.cc");
  url.searchParams.set(kind === "verify" ? "verify" : "reset", value);
  const isVerify = kind === "verify";
  const subject = isVerify ? "滴歲｜驗證你的 Email" : "滴歲｜重設密碼";
  const action = isVerify ? "完成信箱驗證" : "重設登入密碼";
  const body = `你收到這封信，是因為有人在滴歲申請${action}。\n\n請在 ${isVerify ? "30" : "20"} 分鐘內開啟以下連結：\n${url.toString()}\n\n若不是你操作，請忽略此信。`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `disui-${kind}-${await digest(value)}`
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text: body })
  });
  if (!response.ok) {
    console.error("Resend email delivery failed", response.status);
    throw Object.assign(new Error("Email delivery failed"), { code: "EMAIL_DELIVERY_FAILED" });
  }
}

async function sendToken(db, env, user, kind) {
  const now = Date.now();
  const old = await db.prepare(
    "SELECT created_at FROM auth_tokens WHERE kind = ? AND user_id = ?"
  ).bind(kind, user.id).first();
  if (old && now - old.created_at < 60_000) return false;
  const raw = token();
  const hash = await digest(raw);
  const life = kind === "verify" ? EMAIL_TOKEN_MS : RESET_TOKEN_MS;
  await db.prepare(
    `INSERT INTO auth_tokens (kind, user_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, user_id)
     DO UPDATE SET token_hash=excluded.token_hash, created_at=excluded.created_at, expires_at=excluded.expires_at`
  ).bind(kind, user.id, hash, now, now + life).run();
  await sendEmail(env, user.email, kind, raw);
  return true;
}

function base64UrlDecode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid token");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), c => c.charCodeAt(0));
}
async function verifyGoogle(raw, clientId) {
  if (!validGoogleClientId(clientId) || typeof raw !== "string" || raw.length > 10000) throw new Error("Google authentication unavailable");
  const parts = raw.split(".");
  if (parts.length !== 3) throw new Error("Invalid Google token");
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Unexpected Google signature");
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== clientId || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss) ||
      !Number.isFinite(payload.exp) || payload.exp <= now ||
      !Number.isFinite(payload.iat) || payload.iat > now + 120 ||
      typeof payload.sub !== "string" || !/^[0-9]{5,64}$/.test(payload.sub) ||
      payload.email_verified !== true || !normalizeEmail(payload.email)) {
    throw new Error("Google token claims invalid");
  }
  if (googleKeyCache.expires <= Date.now()) {
    const response = await fetch(GOOGLE_KEYS_URL);
    if (!response.ok) throw new Error("Google keys unavailable");
    const data = await response.json();
    if (!Array.isArray(data.keys)) throw new Error("Invalid Google keys");
    googleKeyCache = { keys: data.keys, expires: Date.now() + 5 * 60 * 1000 };
  }
  const jwk = googleKeyCache.keys.find(key => key.kid === header.kid && key.kty === "RSA" &&
    key.alg === "RS256" && key.use === "sig");
  if (!jwk) throw new Error("Google signing key not found");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const sig = base64UrlDecode(parts[2]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, textEncoder.encode(parts[0] + "." + parts[1]))) {
    throw new Error("Google signature mismatch");
  }
  return { sub: payload.sub, email: normalizeEmail(payload.email) };
}

async function executeAuth(request, env, path) {
  const db = env.DB;
  if (path === "/api/auth/config" && request.method === "GET") {
    // A deployed Worker does not mean the D1 account migration has been applied.
    // Check all account tables so the UI can explain setup issues before signup.
    const requiredTables = ["users", "auth_identities", "auth_sessions", "auth_tokens", "pet_owners", "auth_rate_limits", "auth_password_credentials"];
    let authSchemaReady = false;
    try {
      const rows = await db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users','auth_identities','auth_sessions','auth_tokens','pet_owners','auth_rate_limits','auth_password_credentials')"
      ).all();
      authSchemaReady = requiredTables.every(table => rows.results.some(row => row.name === table));
    } catch (error) {
      console.error("Account schema readiness check failed", error);
    }
    return authJson({
      googleClientId: validGoogleClientId(env.GOOGLE_CLIENT_ID) ? env.GOOGLE_CLIENT_ID : null,
      googleConfigInvalid: !!env.GOOGLE_CLIENT_ID && !validGoogleClientId(env.GOOGLE_CLIENT_ID),
      emailEnabled: !!(env.RESEND_API_KEY && env.EMAIL_FROM && passwordPepperReady(env)),
      passwordPepperConfigured: passwordPepperReady(env),
      authSchemaReady
    });
  }
  if (path === "/api/auth/me" && request.method === "GET") {
    const user = await currentUser(request, db);
    return authJson({ user: user ? publicUser(user) : null });
  }
  if (request.method !== "POST") return authJson({ error: "Method not allowed" }, 405, { Allow: "POST" });
  const rejected = requireOrigin(request);
  if (rejected) return rejected;
  const body = await jsonBody(request);
  const now = Date.now();
  if (path === "/api/auth/register") {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return authJson({ error: "尚未設定 Email 寄信服務" }, 503);
    if (!passwordPepperReady(env)) return authJson({ error: "尚未設定 AUTH_PASSWORD_PEPPER" }, 503);
    const email = normalizeEmail(body.email);
    if (!email || !passwordValid(body.password)) return authJson({ error: "Email 或密碼格式不正確（密碼需 10–128 字元）" }, 400);
    if (!await limit(db, request, "register", 5, 60 * 60 * 1000)) return authJson({ error: "請稍後再試" }, 429);
    const exists = await db.prepare(
      "SELECT id, email, email_verified_at FROM users WHERE email = ? LIMIT 1"
    ).bind(email).first();
    // A previous signup may have inserted the account but failed to send email.
    // Allow retry for unverified accounts without revealing whether an email exists.
    if (exists) {
      if (!exists.email_verified_at) await sendToken(db, env, exists, "verify");
      return authJson({ pendingVerification: true }, 202);
    }
    const pass = await hashNewPassword(body.password, env);
    const user = { id: crypto.randomUUID(), email };
    // Insert account and its password atomically; the legacy users.password_*
    // CHECK requires >=200k rounds and is intentionally not used.
    await db.batch([
      db.prepare(
        "INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)"
      ).bind(user.id, email, now, now),
      db.prepare(
        "INSERT INTO auth_password_credentials (user_id, password_hash, password_salt, password_iterations, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(user.id, pass.hash, pass.salt, pass.iterations, now)
    ]);
    await sendToken(db, env, user, "verify");
    return authJson({ pendingVerification: true }, 202);
  }
  if (path === "/api/auth/verify") {
    if (!await limit(db, request, "verify", 20, 15 * 60 * 1000)) return authJson({ error: "請稍後再試" }, 429);
    if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/i.test(body.token)) return authJson({ error: "驗證連結無效" }, 400);
    const hash = await digest(body.token.toLowerCase());
    // Consume the token atomically. Concurrent requests cannot verify it twice.
    const record = await db.prepare(
      "DELETE FROM auth_tokens WHERE kind='verify' AND token_hash=? AND expires_at>? RETURNING user_id"
    ).bind(hash, now).first();
    if (!record) return authJson({ error: "驗證連結已過期或已使用" }, 400);
    await db.prepare(
      "UPDATE users SET email_verified_at=COALESCE(email_verified_at, ?), updated_at=? WHERE id=?"
    ).bind(now, now, record.user_id).run();
    const user = await db.prepare(
      "SELECT id, email, email_verified_at, 1 AS has_password, 0 AS google_linked FROM users WHERE id = ?"
    ).bind(record.user_id).first();
    return issueSession(db, user);
  }
  if (path === "/api/auth/resend-verification") {
    const email = normalizeEmail(body.email);
    if (!email) return authJson({ error: "Email 格式不正確" }, 400);
    if (!await limit(db, request, "resend", 5, 60 * 60 * 1000, email)) return authJson({ error: "請稍後再試" }, 429);
    const user = await db.prepare("SELECT id, email, email_verified_at FROM users WHERE email = ?").bind(email).first();
    if (user && !user.email_verified_at) await sendToken(db, env, user, "verify");
    return authJson({ ok: true }, 202);
  }
  if (path === "/api/auth/login") {
    const email = normalizeEmail(body.email);
    if (!email || !passwordValid(body.password)) return authJson({ error: "Email 或密碼錯誤" }, 401);
    if (!await limit(db, request, "login-ip", 20, 15 * 60 * 1000) ||
        !await limit(db, request, "login-email", 8, 15 * 60 * 1000, email)) {
      return authJson({ error: "登入嘗試太頻繁，請稍後再試" }, 429);
    }
    if (!passwordPepperReady(env)) return authJson({ error: "尚未設定 AUTH_PASSWORD_PEPPER" }, 503);
    const user = await db.prepare(
      `SELECT users.id, users.email, users.email_verified_at,
              creds.password_hash AS credential_hash, creds.password_salt AS credential_salt,
              creds.password_iterations AS credential_iterations,
              (creds.user_id IS NOT NULL) AS has_password,
              EXISTS(SELECT 1 FROM auth_identities WHERE user_id=users.id AND provider='google') AS google_linked
       FROM users LEFT JOIN auth_password_credentials creds ON creds.user_id=users.id
       WHERE users.email = ? LIMIT 1`
    ).bind(email).first();
    if (!await passwordMatches(body.password, user, env)) return authJson({ error: "Email 或密碼錯誤" }, 401);
    if (!user.email_verified_at) return authJson({ error: "請先完成 Email 驗證" }, 403);
    return issueSession(db, user);
  }
  if (path === "/api/auth/google" || path === "/api/auth/google/link") {
    if (!await limit(db, request, "google", 20, 15 * 60 * 1000)) return authJson({ error: "登入太頻繁" }, 429);
    let identity;
    try { identity = await verifyGoogle(body.credential, env.GOOGLE_CLIENT_ID); }
    catch { return authJson({ error: "Google 登入驗證失敗" }, 401); }
    const existing = await db.prepare(
      "SELECT user_id FROM auth_identities WHERE provider='google' AND provider_user_id=?"
    ).bind(identity.sub).first();
    if (path.endsWith("/link")) {
      const current = await currentUser(request, db);
      if (!current) return authJson({ error: "請先登入帳號" }, 401);
      if (current.email !== identity.email) return authJson({ error: "Google 信箱與帳號 Email 不符" }, 409);
      if (existing && existing.user_id !== current.id) return authJson({ error: "此 Google 帳號已被其他使用者綁定" }, 409);
      if (!existing) await db.prepare(
        "INSERT INTO auth_identities (provider, provider_user_id, user_id, created_at) VALUES ('google', ?, ?, ?)"
      ).bind(identity.sub, current.id, now).run();
      return authJson({ user: { ...publicUser(current), googleLinked: true } });
    }
    if (existing) {
      const user = await db.prepare(
        `SELECT id, email, email_verified_at,
                EXISTS(SELECT 1 FROM auth_password_credentials WHERE user_id=users.id) AS has_password,
                1 AS google_linked FROM users WHERE id = ?`
      ).bind(existing.user_id).first();
      return issueSession(db, user);
    }
    // Never merge identities automatically just because an email matches.
    const collision = await db.prepare("SELECT id FROM users WHERE email=?").bind(identity.email).first();
    if (collision) return authJson({ error: "此 Email 已註冊，請先用原本方式登入，再綁定 Google" }, 409);
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO users (id,email,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?)")
        .bind(id, identity.email, now, now, now),
      db.prepare("INSERT INTO auth_identities (provider,provider_user_id,user_id,created_at) VALUES ('google',?,?,?)")
        .bind(identity.sub, id, now)
    ]);
    return issueSession(db, { id, email: identity.email, email_verified_at: now, has_password: 0, google_linked: 1 });
  }
  if (path === "/api/auth/forgot-password") {
    const email = normalizeEmail(body.email);
    if (!email) return authJson({ error: "Email 格式不正確" }, 400);
    if (!await limit(db, request, "forgot", 5, 60 * 60 * 1000, email)) return authJson({ error: "請稍後再試" }, 429);
    const user = await db.prepare(
      "SELECT id, email FROM users WHERE email=? AND email_verified_at IS NOT NULL"
    ).bind(email).first();
    if (user) await sendToken(db, env, user, "reset");
    return authJson({ ok: true }, 202);
  }
  if (path === "/api/auth/reset-password") {
    if (!passwordValid(body.password) || typeof body.token !== "string" ||
        !/^[a-f0-9]{64}$/i.test(body.token)) return authJson({ error: "重設資料格式不正確" }, 400);
    if (!await limit(db, request, "reset", 10, 15 * 60 * 1000)) return authJson({ error: "請稍後再試" }, 429);
    if (!passwordPepperReady(env)) return authJson({ error: "尚未設定 AUTH_PASSWORD_PEPPER" }, 503);
    const hash = await digest(body.token.toLowerCase());
    const pass = await hashNewPassword(body.password, env);
    // Single-use reset links must be consumed atomically even under concurrency.
    const record = await db.prepare(
      "DELETE FROM auth_tokens WHERE kind='reset' AND token_hash=? AND expires_at>? RETURNING user_id"
    ).bind(hash, now).first();
    if (!record) return authJson({ error: "重設連結已過期或已使用" }, 400);
    await db.batch([
      db.prepare(
        `INSERT INTO auth_password_credentials (user_id,password_hash,password_salt,password_iterations,updated_at)
         VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
         password_hash=excluded.password_hash, password_salt=excluded.password_salt,
         password_iterations=excluded.password_iterations, updated_at=excluded.updated_at`
      ).bind(record.user_id, pass.hash, pass.salt, pass.iterations, now),
      db.prepare("UPDATE users SET updated_at=? WHERE id=?").bind(now, record.user_id),
      db.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(record.user_id)
    ]);
    return authJson({ ok: true }, 200, { "Set-Cookie": setCookie("", 0) });
  }
  if (path === "/api/auth/logout") {
    const raw = cookieValue(request);
    if (/^[a-f0-9]{64}$/.test(raw)) {
      await db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(await digest(raw)).run();
    }
    return authJson({ ok: true }, 200, { "Set-Cookie": setCookie("", 0) });
  }
  return authJson({ error: "Not found" }, 404);
}

export async function handleAuth(request, env, path) {
  try { return await executeAuth(request, env, path); }
  catch (error) {
    if (error.status) return authJson({ error: error.message }, error.status);
    console.error("Authentication API failed", error);
    if (/no such table/i.test(String(error.message))) {
      return authJson({ error: "帳號資料表尚未初始化，請執行尚未套用的 D1 Migration（包含 0003）。", code: "AUTH_SCHEMA_MISSING" }, 503);
    }
    if (error.code === "PASSWORD_PEPPER_MISSING") {
      return authJson({ error: "尚未設定 AUTH_PASSWORD_PEPPER，無法安全處理密碼。", code: "AUTH_PEPPER_MISSING" }, 503);
    }
    if (error.code === "INVALID_PASSWORD_KDF") {
      return authJson({ error: "密碼儲存格式不支援，請使用密碼重設功能。", code: "INVALID_PASSWORD_KDF" }, 503);
    }
    if (error.code === "EMAIL_DELIVERY_FAILED" || error.code === "EMAIL_NOT_CONFIGURED") {
      return authJson({ error: "驗證信未能寄出，請檢查 Resend 寄件網域與 API Key；完成設定後可重寄驗證信。", code: "EMAIL_DELIVERY_FAILED" }, 502);
    }
    return authJson({ error: "服務暫時無法使用，請查看 Cloudflare Worker Logs。", code: "AUTH_SERVICE_ERROR" }, 503);
  }
}
