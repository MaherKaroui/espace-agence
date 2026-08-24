import { requireCronAuth } from "@/lib/cron-auth";
import { createFileRoute } from "@tanstack/react-router";

// Appelé chaque minute par le planificateur. Ne fait rien tant qu'aucune
// collecte n'est en cours (garde d'état : pause / terminé / attente de débit).
export const Route = createFileRoute("/api/public/hooks/slack-robot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runTick } = await import("@/server/slackRobot.server");
          const res = await runTick(supabaseAdmin);
          return Response.json({ ok: true, ...res });
        } catch (err: any) {
          console.error("[slack-robot] error:", err);
          return Response.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST pour faire avancer la collecte" }),
    },
  },
});
