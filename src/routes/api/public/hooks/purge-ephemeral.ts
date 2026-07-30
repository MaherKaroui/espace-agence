import { requireCronAuth } from "@/lib/cron-auth";
import { createFileRoute } from "@tanstack/react-router";

type ExpiredRow = {
  source: "messages" | "group_messages" | "internal_messages";
  id: string;
  attachment_path: string | null;
};

export const Route = createFileRoute("/api/public/hooks/purge-ephemeral")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: rows, error: listErr } = await supabaseAdmin.rpc(
            "list_expired_ephemeral" as any,
            { _limit: 500 },
          );
          if (listErr) throw listErr;
          const expired = (rows ?? []) as ExpiredRow[];

          if (expired.length === 0) {
            return Response.json({ ok: true, deleted: 0 });
          }

          // Group attachments by bucket to delete files in bulk.
          const filesByBucket: Record<string, string[]> = {
            "chat-files": [],
            "internal-chat-files": [],
          };
          for (const r of expired) {
            if (!r.attachment_path) continue;
            const bucket = r.source === "internal_messages" ? "internal-chat-files" : "chat-files";
            filesByBucket[bucket].push(r.attachment_path);
          }
          for (const [bucket, paths] of Object.entries(filesByBucket)) {
            if (paths.length === 0) continue;
            try {
              await supabaseAdmin.storage.from(bucket).remove(paths);
            } catch (err) {
              console.error(`[purge-ephemeral] storage remove failed for ${bucket}:`, err);
            }
          }

          // Group IDs by source and delete in bulk.
          const idsBySource: Record<ExpiredRow["source"], string[]> = {
            messages: [],
            group_messages: [],
            internal_messages: [],
          };
          for (const r of expired) idsBySource[r.source].push(r.id);

          for (const src of Object.keys(idsBySource) as ExpiredRow["source"][]) {
            const ids = idsBySource[src];
            if (ids.length === 0) continue;
            const { error: delErr } = await supabaseAdmin.from(src).delete().in("id", ids);
            if (delErr) {
              console.error(`[purge-ephemeral] delete failed for ${src}:`, delErr);
            }
          }

          return Response.json({ ok: true, deleted: expired.length });
        } catch (err: any) {
          console.error("[purge-ephemeral] error:", err);
          return Response.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST to purge" }),
    },
  },
});
