/**
 * Shared secret check for internal background-job endpoints under /api/public/hooks/*.
 * Callers (pg_cron / DB triggers via pg_net) must present the service-role key
 * as a bearer token. Returns a Response when the caller is not authorized.
 */
export function requireCronAuth(request: Request): Response | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = header.slice("Bearer ".length).trim();
  if (token !== secret) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
