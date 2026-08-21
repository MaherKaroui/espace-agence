import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Envoi manuel du rapport d'activité quotidien (admin / direction). */
export const sendActivityReportNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const ok = (roles ?? []).some((r: any) => ["admin", "direction"].includes(r.role));
    if (!ok) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendDailyDigest } = await import("@/lib/daily-activity-report.server");
    const res = await sendDailyDigest(supabaseAdmin);
    return res;
  });
