import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: any) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

export const getSupervisionOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since24 = new Date(Date.now() - 86400_000).toISOString();
    const since30d = new Date(Date.now() - 30 * 86400_000).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    const [errors24, lastChecks, checks30, report, anomalies, errorList] = await Promise.all([
      supabaseAdmin.from("app_errors" as any).select("gravite").gte("created_at", since24),
      supabaseAdmin.from("health_checks" as any).select("is_up, response_time_ms, created_at").order("created_at", { ascending: false }).limit(96),
      supabaseAdmin.from("health_checks" as any).select("is_up, created_at").gte("created_at", since30d).limit(5000),
      supabaseAdmin.from("ai_reports" as any).select("id, report_date, health_score, diagnostic, problems, stats").order("report_date", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("data_anomalies" as any).select("kind, label, gravite, count, details").eq("check_date", today),
      supabaseAdmin.from("app_errors" as any).select("id, type, message, stack, url_page, gravite, statut, navigateur, created_at").order("created_at", { ascending: false }).limit(300),
    ]);

    const e24 = (errors24.data ?? []) as any[];
    const hc = (lastChecks.data ?? []) as any[];
    const rep = (report as any).data as any;

    let suggestions: any[] = [];
    if (rep?.id) {
      const { data } = await supabaseAdmin.from("ai_suggestions" as any).select("id, titre, priorite, impact, action, statut").eq("report_id", rep.id).order("priorite");
      suggestions = (data ?? []) as any[];
    }

    // Séries 30 jours : erreurs/jour + disponibilité/jour
    const { data: errs30 } = await supabaseAdmin.from("app_errors" as any).select("created_at").gte("created_at", since30d).limit(5000);
    const byDay = new Map<string, { day: string; erreurs: number; up: number; total: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      byDay.set(d, { day: d, erreurs: 0, up: 0, total: 0 });
    }
    for (const e of ((errs30 ?? []) as any[])) {
      const d = String(e.created_at).slice(0, 10);
      const row = byDay.get(d); if (row) row.erreurs++;
    }
    for (const c of (((checks30 as any).data ?? []) as any[])) {
      const d = String(c.created_at).slice(0, 10);
      const row = byDay.get(d); if (row) { row.total++; if (c.is_up) row.up++; }
    }
    const serie = [...byDay.values()].map((r) => ({
      day: r.day,
      erreurs: r.erreurs,
      uptime: r.total ? Math.round((r.up / r.total) * 1000) / 10 : 100,
    }));

    let cronJobs: any[] = [];
    try {
      const { data } = await supabaseAdmin.rpc("cron_jobs_health" as any);
      cronJobs = (data ?? []) as any[];
    } catch (e) {
      console.error("[supervision] cron jobs failed", e);
    }

    return {
      cronJobs,
      score: rep?.health_score ?? null,
      diagnostic: rep?.diagnostic ?? null,
      reportDate: rep?.report_date ?? null,
      problems: rep?.problems ?? [],
      suggestions,
      anomalies: (anomalies.data ?? []) as any[],
      errors: (errorList.data ?? []) as any[],
      erreurs24h: e24.length,
      erreursCritiques24h: e24.filter((x) => x.gravite === "critique").length,
      siteUp: hc.length ? Boolean(hc[0].is_up) : null,
      avgMs: hc.length ? Math.round(hc.reduce((s, c) => s + (c.response_time_ms ?? 0), 0) / hc.length) : null,
      lastCheckAt: hc.length ? hc[0].created_at : null,
      serie,
    };
  });

export const setErrorStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; statut: "nouveau" | "vu" | "resolu" }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_errors" as any).update({ statut: data.statut } as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setSuggestionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; statut: "nouveau" | "a_faire" | "ignoree" }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("ai_suggestions" as any).update({ statut: data.statut } as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runSupervisionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runAiSupervision } = await import("@/lib/ai-supervisor.server");
    const res = await runAiSupervision(supabaseAdmin);
    return { ok: true, score: res.score, suggestions: res.suggestions.length };
  });
