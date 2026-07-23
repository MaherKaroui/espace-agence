import { createFileRoute } from "@tanstack/react-router";

// ---------- helpers ----------
function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Uint8Array {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function jsonB64Url(o: unknown): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function u16(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 255, n & 255]);
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  const okm = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

async function exportRawPublicKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

async function encryptWebPushPayload(payload: unknown, userPublicKeyB64: string, userAuthB64: string) {
  const userPublicKey = b64urlDecode(userPublicKeyB64);
  const authSecret = b64urlDecode(userAuthB64);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const appServerKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const appServerPublicKey = await exportRawPublicKey(appServerKeys.publicKey);
  const userKey = await crypto.subtle.importKey("raw", userPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: userKey }, appServerKeys.privateKey, 256),
  );

  const context = concatBytes(
    new TextEncoder().encode("P-256\0"),
    u16(userPublicKey.length),
    userPublicKey,
    u16(appServerPublicKey.length),
    appServerPublicKey,
  );
  const ikm = await hkdf(
    authSecret,
    sharedSecret,
    concatBytes(new TextEncoder().encode("WebPush: info\0"), context),
    32,
  );
  const cek = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const plaintext = concatBytes(
    new TextEncoder().encode(JSON.stringify(payload)),
    new Uint8Array([2]),
  );
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

  return concatBytes(salt, u32(4096), new Uint8Array([appServerPublicKey.length]), appServerPublicKey, ciphertext);
}

async function signVapidJwt(audOrigin: string, subject: string, privB64: string, pubB64: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audOrigin, exp: now + 12 * 3600, sub: subject };
  const unsigned = jsonB64Url(header) + "." + jsonB64Url(payload);

  const pubRaw = b64urlDecode(pubB64); // 65 bytes: 0x04 || X(32) || Y(32)
  const x = pubRaw.slice(1, 33);
  const y = pubRaw.slice(33, 65);
  const jwk: JsonWebKey = {
    kty: "EC", crv: "P-256",
    d: privB64,
    x: b64urlEncode(x),
    y: b64urlEncode(y),
    ext: true,
  };
  const key = await crypto.subtle.importKey(
    "jwk", jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned)
  );
  return unsigned + "." + b64urlEncode(sig);
}

// ---------- route ----------
export const Route = createFileRoute("/api/public/hooks/push-fanout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const VAPID_PUB = process.env.VAPID_PUBLIC_KEY;
          const VAPID_PRIV = process.env.VAPID_PRIVATE_KEY;
          const VAPID_SUB = process.env.VAPID_SUBJECT || "mailto:admin@izisuivis.com";
          if (!VAPID_PUB || !VAPID_PRIV) {
            return new Response(JSON.stringify({ ok: false, reason: "vapid_missing" }), {
              status: 200, headers: { "Content-Type": "application/json" },
            });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const body = await request.json().catch(() => ({}));

          let notification: any = null;
          if (body?.notification_id) {
            const { data } = await supabaseAdmin
              .from("notifications")
              .select("id, user_id, type, titre, message, link, created_at")
              .eq("id", body.notification_id)
              .maybeSingle();
            notification = data;
          } else if (body?.user_id) {
            notification = {
              id: crypto.randomUUID(),
              user_id: body.user_id,
              type: body.type ?? "notification",
              titre: body.titre ?? "IZISuivis",
              message: body.message ?? "Nouvelle notification",
              link: body.link ?? "/notifications",
            };
          }

          if (!notification?.user_id) {
            return new Response(JSON.stringify({ ok: false, reason: "notification_missing" }), {
              status: 200, headers: { "Content-Type": "application/json" },
            });
          }

          const { data: subs } = await supabaseAdmin
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .eq("user_id", notification.user_id);

          if (!subs || subs.length === 0) {
            return new Response(JSON.stringify({ ok: true, sent: 0 }), {
              status: 200, headers: { "Content-Type": "application/json" },
            });
          }

          const jwtCache = new Map<string, string>();
          let sent = 0;
          let removed = 0;

          const notificationPayload = {
            id: notification.id,
            type: notification.type,
            titre: notification.titre,
            message: notification.message,
            link: notification.link || "/notifications",
            tag: `${notification.type}:${notification.link || notification.id}`,
          };

          await Promise.all(subs.map(async (sub: any) => {
            try {
              const url = new URL(sub.endpoint);
              const origin = url.origin;
              let jwt = jwtCache.get(origin);
              if (!jwt) {
                jwt = await signVapidJwt(origin, VAPID_SUB, VAPID_PRIV, VAPID_PUB);
                jwtCache.set(origin, jwt);
              }
              const encrypted = await encryptWebPushPayload(notificationPayload, sub.p256dh, sub.auth);
              const res = await fetch(sub.endpoint, {
                method: "POST",
                headers: {
                  "TTL": "60",
                  "Urgency": "normal",
                  "Content-Type": "application/octet-stream",
                  "Content-Encoding": "aes128gcm",
                  "Authorization": `vapid t=${jwt}, k=${VAPID_PUB}`,
                },
                body: encrypted,
              });
              if (res.status === 404 || res.status === 410) {
                await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
                removed++;
              } else if (res.status >= 200 && res.status < 300) {
                sent++;
              }
            } catch {
              // silent — do not break others
            }
          }));

          return new Response(JSON.stringify({ ok: true, sent, removed }), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }
      },
      OPTIONS: async () => new Response(null, { status: 204 }),
    },
  },
});
