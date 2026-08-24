import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Origines autorisées pour l'appel interne au routeur d'e-mails. */
const ALLOWED_ORIGIN =
  /^https?:\/\/([\w-]+\.)*(lovable\.app|lovableproject\.com|izisuivis\.com|localhost(:\d+)?)$/;

/** Envoi manuel du compte rendu quotidien (admin / direction). */
export const sendActivityReportNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ origin: z.string().optional(), to: z.string().email().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const ok = (roles ?? []).some((r: any) => ["admin", "direction"].includes(r.role));
    if (!ok) throw new Error("Forbidden");

    const origin = data.origin && ALLOWED_ORIGIN.test(data.origin) ? data.origin : undefined;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendDailyDigest } = await import("@/lib/daily-activity-report.server");
    return await sendDailyDigest(supabaseAdmin, origin, data.to);
  });

/** Liste les comptes rendus PDF archivés (90 derniers jours) — admin / direction. */
export const listArchivedDigests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const ok = (roles ?? []).some((r: any) => ["admin", "direction"].includes(r.role));
    if (!ok) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { DIGEST_BUCKET } = await import("@/lib/daily-activity-report.server");

    const since = new Date(Date.now() - 90 * 86400_000);
    const months = new Set<string>();
    for (let d = new Date(since); d <= new Date(); d.setDate(d.getDate() + 1)) {
      months.add(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const files: { path: string; date: string; size: number }[] = [];
    for (const prefix of months) {
      const { data } = await supabaseAdmin.storage
        .from(DIGEST_BUCKET)
        .list(prefix, { limit: 100, sortBy: { column: "name", order: "desc" } });
      for (const f of data ?? []) {
        const m = /compte-rendu-(\d{4}-\d{2}-\d{2})\.pdf$/.exec(f.name);
        if (!m) continue;
        if (new Date(m[1]!) < since) continue;
        files.push({ path: `${prefix}/${f.name}`, date: m[1]!, size: (f as any).metadata?.size ?? 0 });
      }
    }
    files.sort((a, b) => b.date.localeCompare(a.date));
    return files;
  });

/** URL signée à la demande pour un compte rendu archivé — admin / direction. */
export const getArchivedDigestUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ path: z.string().regex(/^\d{4}\/\d{2}\/compte-rendu-\d{4}-\d{2}-\d{2}\.pdf$/) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const ok = (roles ?? []).some((r: any) => ["admin", "direction"].includes(r.role));
    if (!ok) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { DIGEST_BUCKET } = await import("@/lib/daily-activity-report.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(DIGEST_BUCKET)
      .createSignedUrl(data.path, 300);
    if (error) throw new Error(error.message);
    return { url: signed?.signedUrl ?? null };
  });

/** Regénère un compte rendu archivé avec la mise en page actuelle — admin / direction. */
export const regenerateArchivedDigest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const ok = (roles ?? []).some((r: any) => ["admin", "direction"].includes(r.role));
    if (!ok) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { regenerateDigestPdf } = await import("@/lib/daily-activity-report.server");
    return await regenerateDigestPdf(supabaseAdmin, data.date);
  });
