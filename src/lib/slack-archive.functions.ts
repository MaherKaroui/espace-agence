import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const importRowSchema = z.object({
  channel_id: z.string(),
  channel_name: z.string(),
  message_ts: z.string(),
  libelle: z.string().min(1),
  plateforme: z.string().nullish(),
  url: z.string().nullish(),
  identifiant: z.string().nullish(),
  secret: z.string().nullish(),
  client_id: z.string().uuid().nullish(),
  organisme: z.string().nullish(),
});

export const slackSuggestChannelClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const s = await import("@/server/slackArchive.server");
    return s.suggestChannelClients(context.supabase);
  });

export const slackScanArchiveAcces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ canalIds: z.array(z.string().uuid()).nullish() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const s = await import("@/server/slackArchive.server");
    return s.scanArchiveAcces(context.supabase, data.canalIds ?? null);
  });

export const slackImportArchiveAcces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rows: z.array(importRowSchema).min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const s = await import("@/server/slackAcces.server");
    return s.slackImport(context.supabase, context.userId, data.rows as any);
  });

export const slackDownloadFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(10) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const s = await import("@/server/slackArchive.server");
    return s.downloadSlackFiles(context.supabase, data.ids);
  });

export const slackFileSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const { data: f } = await context.supabase
      .from("slack_fichiers")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (!f?.storage_path) throw new Error("Ce fichier n'a pas encore été rapatrié.");
    const { data: signed, error } = await context.supabase.storage
      .from("slack-fichiers")
      .createSignedUrl(f.storage_path, 300);
    if (error) throw error;
    return { url: signed.signedUrl };
  });
