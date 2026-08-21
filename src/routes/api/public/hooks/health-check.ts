import { createFileRoute } from "@tanstack/react-router";
import { requireCronAuth } from "@/lib/cron-auth";

const TARGET = "https://izisuivis.com";
const PAGES = ["/", "/auth", "/dashboard", "/admin/direction"];
const SLOW_MS = 3000;

async function probe(path: string) {
  const started = Date.now();
  try {
    const res = await fetch(`${TARGET}${path}`, { method: "GET", redirect: "follow" });
    return { path, status: res.status, ms: Date.now() - started, ok: res.status < 500 };
  } catch (e) {
    return { path, status: 0, ms: Date.now() - started, ok: false, error: String(e).slice(0, 200) };
  }
}

export const Route = createFileRoute("/api/public/hooks/health-check")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST pour lancer un health check" }),
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { sendImmediateAlert } = await import("@/lib/supervision.server");

          const results = [];
          for (const p of PAGES) results.push(await probe(p));
          const home = results[0]!;
          const isUp = home.ok && home.status > 0;
          const avg = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);

          // Certificat SSL : une réponse https valide implique une chaîne acceptée par le runtime.
          let sslValid: boolean | null = null;
          let sslExpires: string | null = null;
          try {
            const res = await fetch(TARGET, { method: "HEAD" });
            sslValid = res.status > 0;
            const cf = (res as any).cf;
            if (cf?.tlsExportedAuthenticator || cf?.clientTcpRtt) sslValid = true;
          } catch {
            sslValid = false;
          }

          await supabaseAdmin.from("health_checks" as any).insert({
            url: TARGET,
            http_status: home.status,
            response_time_ms: home.ms,
            is_up: isUp,
            ssl_valid: sslValid,
            ssl_expires_at: sslExpires,
            pages: results,
            error_message: isUp ? null : (home as any).error ?? `HTTP ${home.status}`,
          } as any);

          if (!isUp) {
            await sendImmediateAlert(supabaseAdmin, "site_down", {
              titre: "Site inaccessible",
              detail: `Réponse HTTP ${home.status} sur ${TARGET}. Temps : ${home.ms} ms.`,
              gravite: "critique",
              page: TARGET,
            });
          } else if (home.ms > SLOW_MS) {
            await sendImmediateAlert(supabaseAdmin, "site_slow", {
              titre: "Temps de réponse dégradé",
              detail: `La page d'accueil répond en ${home.ms} ms (seuil ${SLOW_MS} ms).`,
              gravite: "majeur",
              page: TARGET,
            });
          }
          const brokenPage = results.slice(1).find((r) => !r.ok);
          if (isUp && brokenPage) {
            await sendImmediateAlert(supabaseAdmin, `page_down_${brokenPage.path}`, {
              titre: `Page en erreur : ${brokenPage.path}`,
              detail: `HTTP ${brokenPage.status}`,
              gravite: "majeur",
              page: `${TARGET}${brokenPage.path}`,
            });
          }

          // Surveillance des tâches planifiées
          let cronFailures: any[] = [];
          try {
            const { data: jobs, error } = await supabaseAdmin.rpc("cron_jobs_health" as any);
            if (error) console.error("[health-check] cron_jobs_health failed", error.message);
            cronFailures = ((jobs ?? []) as any[]).filter((j) => (j.recent_failures ?? 0) >= 2);
            for (const j of cronFailures) {
              await sendImmediateAlert(supabaseAdmin, `cron_failed_${j.jobname}`, {
                titre: `Tâche planifiée en échec : ${j.jobname}`,
                detail: `${j.recent_failures} échecs sur la dernière heure. Dernier statut : ${j.last_status ?? "inconnu"}. ${j.last_message ?? ""}`,
                gravite: "critique",
                page: `${TARGET}/admin/agent-ia`,
              });
            }
          } catch (e) {
            console.error("[health-check] cron monitoring failed", e);
          }

          return Response.json({ cron_failures: cronFailures.length, ok: true, is_up: isUp, response_time_ms: home.ms, avg_ms: avg, pages: results });
        } catch (e) {
          console.error("[health-check] failed", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
