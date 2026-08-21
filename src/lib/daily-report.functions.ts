import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Origines autorisées pour l'appel interne au routeur d'e-mails. */
const ALLOWED_ORIGIN = /^https:\/\/([\w-]+\.)*(lovable\.app|izisuivis\.com)$/;

/** Envoi manuel du compte rendu quotidien (admin / direction). */
export const sendActivityReportNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ origin: z.string().optional() }).parse(data ?? {}),
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
    return await sendDailyDigest(supabaseAdmin, origin);
  });
