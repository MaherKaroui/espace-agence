import { createFileRoute } from "@tanstack/react-router";
import { requireCronAuth } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/hooks/supervision-report")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST pour envoyer le rapport quotidien" }),
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;
        try {
          const url = new URL(request.url);
          const force = url.searchParams.get("force") === "1";
          const { isParisHour, sendSupervisionEmail } = await import("@/lib/supervision.server");
          if (!force && !isParisHour(19, 0)) {
            return Response.json({ ok: true, skipped: "hors créneau 19h Europe/Paris" });
          }
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const today = new Date().toISOString().slice(0, 10);
          const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

          const { data: reports } = await supabaseAdmin
            .from("ai_reports" as any)
            .select("id, report_date, health_score, diagnostic, problems, stats")
            .in("report_date", [today, yesterday]);
          const list = (reports ?? []) as any[];
          const todayReport = list.find((r) => r.report_date === today);
          const prev = list.find((r) => r.report_date === yesterday);

          const { data: suggestions } = todayReport
            ? await supabaseAdmin.from("ai_suggestions" as any).select("titre, priorite, impact, action").eq("report_id", todayReport.id).limit(5)
            : { data: [] as any[] };

          const { data: anomalies } = await supabaseAdmin
            .from("data_anomalies" as any)
            .select("label, count, gravite")
            .eq("check_date", today);

          const since = new Date(Date.now() - 86400_000).toISOString();
          const { data: errors } = await supabaseAdmin
            .from("app_errors" as any)
            .select("gravite")
            .gte("created_at", since);
          const errs = (errors ?? []) as any[];

          const stats = todayReport?.stats ?? {};
          const dateFr = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

          const ok = await sendSupervisionEmail(supabaseAdmin, {
            templateName: "supervision-rapport",
            type: "rapport_quotidien",
            idempotencyKey: `supervision-rapport-${today}`,
            templateData: {
              dateFr,
              score: todayReport?.health_score ?? 0,
              scoreVeille: prev?.health_score ?? null,
              uptime: stats.uptime ?? 100,
              erreursCritiques: errs.filter((e) => e.gravite === "critique").length,
              erreursMajeures: errs.filter((e) => e.gravite === "majeur").length,
              diagnostic: todayReport?.diagnostic ?? null,
              problems: todayReport?.problems ?? [],
              anomalies: (anomalies ?? []) as any[],
              suggestions: (suggestions ?? []) as any[],
            },
          });

          return Response.json({ ok });
        } catch (e) {
          console.error("[supervision-report] failed", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
