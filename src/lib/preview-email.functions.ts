import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const previewEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ templateName: z.string() }).parse(data))
  .handler(async ({ data, context }) => {
    // Verify the caller is admin/direction
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const ok = roles?.some((r) => ["admin", "direction"].includes(r.role));
    if (!ok) throw new Error("Forbidden");

    const [{ render }, { TEMPLATES }, React] = await Promise.all([
      import("@react-email/render"),
      import("@/lib/email-templates/registry"),
      import("react"),
    ]);

    const entry = TEMPLATES[data.templateName];
    if (!entry) throw new Error("Template introuvable");
    const props = entry.previewData ?? {};
    const html = await render(React.createElement(entry.component as any, props));
    const subject = typeof entry.subject === "function" ? entry.subject(props as any) : entry.subject;
    return { html, subject, displayName: entry.displayName ?? data.templateName };
  });
