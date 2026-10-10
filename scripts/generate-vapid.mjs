// Run locally: node scripts/generate-vapid.mjs
// These keys identify this site's Web Push sender. Keep the private key secret.
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const publicBytes = Buffer.concat([
  Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")
]);
console.log("PUSH_VAPID_PUBLIC_KEY=" + publicBytes.toString("base64url"));
console.log("PUSH_VAPID_PRIVATE_KEY=" + priv.d);
console.log("");
console.log("請把上面兩組值分別存到 Cloudflare Worker Secrets，");
console.log("不要貼到聊天、上傳 GitHub，尤其不能公開私鑰！");
