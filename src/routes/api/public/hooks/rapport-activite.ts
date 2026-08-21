import { createFileRoute } from "@tanstack/react-router";
import { requireCronAuth } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/hooks/rapport-activite")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST pour envoyer le compte rendu quotidien" }),
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;
        try {
          const url = new URL(request.url);
          const force = url.searchParams.get("force") === "1";
          const toParam = url.searchParams.get("to")?.trim() || undefined;
          if (toParam && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toParam)) {
            return Response.json({ ok: false, error: "adresse invalide" }, { status: 400 });
          }
          const { isParisHour } = await import("@/lib/supervision.server");
          const { sendDailyDigest, isParisWeekend, parisDateKey } = await import(
            "@/lib/daily-activity-report.server"
          );

          if (!force && isParisWeekend()) {
            return Response.json({ ok: true, skipped: "week-end" });
          }
          if (!force && !isParisHour(19, 0)) {
            return Response.json({ ok: true, skipped: "hors créneau 19h Europe/Paris" });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const res = await sendDailyDigest(supabaseAdmin, new URL(request.url).origin, toParam);
          return Response.json({ ...res, date: parisDateKey(), test: Boolean(toParam) });
        } catch (e) {
          console.error("[rapport-activite] failed", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
