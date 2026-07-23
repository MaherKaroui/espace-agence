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

          const body = await request.json().catch(() => ({}));
          const userId: string | undefined = body?.user_id;
          if (!userId) {
            return new Response(JSON.stringify({ ok: false, reason: "user_id_missing" }), {
              status: 200, headers: { "Content-Type": "application/json" },
            });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: subs } = await supabaseAdmin
            .from("push_subscriptions")
            .select("id, endpoint")
            .eq("user_id", userId);

          if (!subs || subs.length === 0) {
            return new Response(JSON.stringify({ ok: true, sent: 0 }), {
              status: 200, headers: { "Content-Type": "application/json" },
            });
          }

          const jwtCache = new Map<string, string>();
          let sent = 0;
          let removed = 0;

          await Promise.all(subs.map(async (sub: any) => {
            try {
              const url = new URL(sub.endpoint);
              const origin = url.origin;
              let jwt = jwtCache.get(origin);
              if (!jwt) {
                jwt = await signVapidJwt(origin, VAPID_SUB, VAPID_PRIV, VAPID_PUB);
                jwtCache.set(origin, jwt);
              }
              const res = await fetch(sub.endpoint, {
                method: "POST",
                headers: {
                  "TTL": "60",
                  "Authorization": `vapid t=${jwt}, k=${VAPID_PUB}`,
                },
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
