// Standards-based Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) using
// WebCrypto only. Runs on Cloudflare Workers without Node/npm dependencies.
const encoder = new TextEncoder();

export function decodeUrlBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
export function encodeUrlBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function join(...parts) {
  const bytes = new Uint8Array(parts.reduce((total, p) => total + p.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
}
async function hkdfExtract(salt, input) { return hmac(salt, input); }
async function hkdfExpand(prk, info, length) {
  return (await hmac(prk, join(info, new Uint8Array([1])))).slice(0, length);
}

export function allowedPushEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  let parsed;
  try { parsed = new URL(endpoint); } catch { return false; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.port || parsed.hash) return false;
  const host = parsed.hostname.toLowerCase();
  const trusted =
    host === "fcm.googleapis.com" ||
    host === "fcmregistrations.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host === "push.services.mozilla.com" ||
    host === "web.push.apple.com" ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".notify.windows.com") ||
    host.endsWith(".wns.windows.com");
  // A few push services (notably Windows) carry an opaque token in the query.
  // Only trusted HTTPS push hosts are allowed to receive these URLs.
  return trusted && (parsed.pathname.length > 1 || parsed.search.length > 0);
}

export function pushConfigured(env) {
  try {
    const pub = decodeUrlBase64(env.PUSH_VAPID_PUBLIC_KEY);
    const priv = decodeUrlBase64(env.PUSH_VAPID_PRIVATE_KEY);
    return pub.length === 65 && pub[0] === 4 && priv.length === 32 &&
      typeof env.PUSH_VAPID_SUBJECT === "string" &&
      /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(env.PUSH_VAPID_SUBJECT);
  } catch { return false; }
}

async function vapidHeader(endpoint, env, now) {
  const publicBytes = decodeUrlBase64(env.PUSH_VAPID_PUBLIC_KEY);
  const jwk = {
    kty: "EC", crv: "P-256",
    x: encodeUrlBase64(publicBytes.slice(1, 33)),
    y: encodeUrlBase64(publicBytes.slice(33, 65)),
    d: env.PUSH_VAPID_PRIVATE_KEY,
    ext: false
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = encodeUrlBase64(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = encodeUrlBase64(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: env.PUSH_VAPID_SUBJECT
  })));
  const input = header + "." + payload;
  // WebCrypto ECDSA emits the 64-byte JOSE P1363 signature, not ASN.1 DER.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(input)));
  if (signature.length !== 64) throw new Error("Unexpected VAPID ECDSA signature format");
  return `vapid t=${input}.${encodeUrlBase64(signature)}, k=${env.PUSH_VAPID_PUBLIC_KEY}`;
}

export async function encryptPushPayload(subscription, message) {
  const clientPublic = decodeUrlBase64(subscription.p256dh);
  const authSecret = decodeUrlBase64(subscription.auth_secret);
  if (clientPublic.length !== 65 || clientPublic[0] !== 4 || authSecret.length !== 16) {
    throw new Error("Invalid client encryption keys");
  }
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const clientKey = await crypto.subtle.importKey("raw", clientPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, ephemeral.privateKey, 256));
  const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const keyPrk = await hkdfExtract(authSecret, shared);
  const keyInfo = join(encoder.encode("WebPush: info"), new Uint8Array([0]), clientPublic, ephemeralPublic);
  const ikm = await hkdfExpand(keyPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const keyBytes = await hkdfExpand(prk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  // RFC 8188 final record delimiter (0x02), followed by the GCM tag.
  const plaintext = join(encoder.encode(JSON.stringify(message)), new Uint8Array([2]));
  if (plaintext.length > 3000) throw new Error("Push message too large");
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, plaintext));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096-byte record size, network order.
  return join(salt, rs, new Uint8Array([ephemeralPublic.length]), ephemeralPublic, ciphertext);
}

export async function sendWebPush(subscription, env, message, now = Date.now()) {
  if (!allowedPushEndpoint(subscription.endpoint) || !pushConfigured(env)) {
    throw new Error("Push endpoint or VAPID is not configured correctly");
  }
  const [body, authorization] = await Promise.all([
    encryptPushPayload(subscription, message),
    vapidHeader(subscription.endpoint, env, now)
  ]);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "21600",
      Urgency: "normal"
    },
    body
  });
  return response.status;
}
