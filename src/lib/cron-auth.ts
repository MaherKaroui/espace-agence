/**
 * Shared secret check for internal background-job endpoints under /api/public/hooks/*.
 * Callers (pg_cron / DB triggers via pg_net) must present CRON_SECRET as a bearer token.
 * The service-role key is still accepted as a transitional fallback.
 * PUSH_HOOK_SECRET is only accepted by endpoints that opt in with allowPushSecret.
 */

/** Constant-time string comparison (no node:crypto: runs on Workers). */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function requireCronAuth(
  request: Request,
  opts?: { allowPushSecret?: boolean },
): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  const hookSecret = opts?.allowPushSecret === true ? process.env.PUSH_HOOK_SECRET : undefined;
  // Transitional fallback: to be removed once the crons use CRON_SECRET.
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cronSecret && !legacy && !hookSecret) {
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = header.slice("Bearer ".length).trim();
  const ok = [cronSecret, legacy, hookSecret].some((s) => !!s && safeEqual(token, s));
  if (!ok) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
