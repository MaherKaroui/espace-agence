/**
 * Génération du diagnostic IA quotidien (Lovable AI Gateway).
 */
import { computeAnomalies, persistAnomalies } from "@/lib/supervision.server";

export interface AiReportResult {
  reportId: string | null;
  score: number;
  diagnostic: string;
  problems: any[];
  suggestions: any[];
  stats: Record<string, any>;
}

function sinceIso(hours: number) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

export async function gatherSupervisionContext(admin: any) {
  const since = sinceIso(24);
  const [{ data: errors }, { data: checks }] = await Promise.all([
    admin.from("app_errors").select("type, message, gravite, statut, url_page, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(300),
    admin.from("health_checks").select("is_up, http_status, response_time_ms, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(200),
  ]);
  const errs = (errors ?? []) as any[];
  const hc = (checks ?? []) as any[];
  const anomalies = await computeAnomalies(admin);
  await persistAnomalies(admin, anomalies);

  const upCount = hc.filter((c) => c.is_up).length;
  const uptime = hc.length ? Math.round((upCount / hc.length) * 1000) / 10 : 100;
  const avgMs = hc.length ? Math.round(hc.reduce((s, c) => s + (c.response_time_ms ?? 0), 0) / hc.length) : 0;

  return {
    errors: errs,
    stats: {
      erreurs24h: errs.length,
      erreursCritiques: errs.filter((e) => e.gravite === "critique").length,
      erreursMajeures: errs.filter((e) => e.gravite === "majeur").length,
      uptime,
      avgMs,
      siteUp: hc.length ? hc[0].is_up : null,
      anomaliesTotal: anomalies.reduce((s, a) => s + a.count, 0),
    },
    anomalies,
  };
}

function heuristicScore(stats: any, anomalies: any[]) {
  let score = 100;
  score -= Math.min(30, stats.erreursCritiques * 8);
  score -= Math.min(20, stats.erreursMajeures * 2);
  score -= Math.round((100 - stats.uptime) * 2);
  if (stats.avgMs > 3000) score -= 10;
  score -= Math.min(20, anomalies.filter((a) => a.gravite === "critique").length * 5);
  return Math.max(0, Math.min(100, score));
}

export async function runAiSupervision(admin: any): Promise<AiReportResult> {
  const ctx = await gatherSupervisionContext(admin);
  const fallbackScore = heuristicScore(ctx.stats, ctx.anomalies);

  let parsed: any = null;
  try {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");
    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const { generateText } = await import("ai");
    const gateway = createLovableAiGatewayProvider(key);

    const topErrors = ctx.errors.slice(0, 60).map((e) => `${e.gravite} | ${e.type} | ${e.message} | ${e.url_page ?? ""}`);
    const prompt = [
      "Voici l'état de l'application IZISuivis (plateforme de suivi de dossiers Qualiopi) sur les dernières 24h.",
      `Statistiques: ${JSON.stringify(ctx.stats)}`,
      `Anomalies de données: ${JSON.stringify(ctx.anomalies.map((a) => ({ kind: a.kind, label: a.label, gravite: a.gravite, count: a.count })))}`,
      `Erreurs (échantillon):\n${topErrors.join("\n") || "aucune"}`,
      "",
      "Réponds UNIQUEMENT en JSON valide, sans texte autour, au format :",
      `{"score":0-100,"diagnostic":"texte clair en français (5 lignes max)","problems":[{"titre":"","priorite":"critique|majeur|mineur","cause":"","correction":""}],"suggestions":[{"titre":"","priorite":"critique|majeur|mineur","impact":"","action":""}]}`,
      "Donne 3 à 5 suggestions concrètes (UX, performance, organisation des tâches, process d'équipe).",
    ].join("\n");

    const { text } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      system: "Tu es un ingénieur SRE et product analyst. Tu réponds strictement en JSON valide, en français.",
      prompt,
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch (e) {
    console.error("[ai-supervisor] IA indisponible, fallback heuristique", e);
  }

  const score = typeof parsed?.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : fallbackScore;
  const diagnostic: string = parsed?.diagnostic ??
    `Analyse automatique : ${ctx.stats.erreurs24h} erreur(s) sur 24h (dont ${ctx.stats.erreursCritiques} critique(s)), disponibilité ${ctx.stats.uptime}%, temps de réponse moyen ${ctx.stats.avgMs} ms, ${ctx.stats.anomaliesTotal} anomalie(s) de données.`;
  const problems = Array.isArray(parsed?.problems) ? parsed.problems : [];
  const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];

  const today = new Date().toISOString().slice(0, 10);
  let reportId: string | null = null;
  try {
    const { data } = await admin
      .from("ai_reports")
      .upsert(
        { report_date: today, health_score: score, diagnostic, problems, stats: ctx.stats },
        { onConflict: "report_date" },
      )
      .select("id")
      .single();
    reportId = data?.id ?? null;
  } catch (e) {
    console.error("[ai-supervisor] enregistrement rapport échoué", e);
  }

  if (reportId && suggestions.length) {
    try {
      await admin.from("ai_suggestions").delete().eq("report_id", reportId);
      await admin.from("ai_suggestions").insert(
        suggestions.slice(0, 6).map((s: any) => ({
          report_id: reportId,
          titre: String(s.titre ?? "Suggestion").slice(0, 300),
          priorite: ["critique", "majeur", "mineur"].includes(s.priorite) ? s.priorite : "mineur",
          impact: s.impact ? String(s.impact).slice(0, 500) : null,
          action: s.action ? String(s.action).slice(0, 1000) : null,
        })),
      );
    } catch (e) {
      console.error("[ai-supervisor] enregistrement suggestions échoué", e);
    }
  }

  return { reportId, score, diagnostic, problems, suggestions, stats: ctx.stats };
}
