import { createFileRoute } from "@tanstack/react-router";
import { requireCronAuth } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/hooks/ai-supervisor")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST pour lancer l'analyse IA" }),
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;
        try {
          const { isParisHour } = await import("@/lib/supervision.server");
          const url = new URL(request.url);
          const force = url.searchParams.get("force") === "1";
          // Le cron tourne à 16h45 et 17h45 UTC : on ne garde que 18h45 Europe/Paris.
          if (!force && !isParisHour(18, 45)) {
            return Response.json({ ok: true, skipped: "hors créneau 18h45 Europe/Paris" });
          }
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runAiSupervision } = await import("@/lib/ai-supervisor.server");
          const result = await runAiSupervision(supabaseAdmin);
          return Response.json({ ok: true, score: result.score, suggestions: result.suggestions.length });
        } catch (e) {
          console.error("[ai-supervisor] failed", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
