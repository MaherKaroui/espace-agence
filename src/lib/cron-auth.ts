/**
 * Shared secret check for internal background-job endpoints under /api/public/hooks/*.
 * Callers (pg_cron / DB triggers via pg_net) must present CRON_SECRET as a bearer token.
 * The service-role key is still accepted as a transitional fallback.
 */
export function requireCronAuth(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cronSecret && !legacy) {
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = header.slice("Bearer ".length).trim();
  if (token !== cronSecret && token !== legacy) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
