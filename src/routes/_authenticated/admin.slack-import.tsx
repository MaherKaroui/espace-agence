import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Slack } from "lucide-react";
import { SlackCanauxExplorer } from "@/components/slack-canaux-explorer";

export const Route = createFileRoute("/_authenticated/admin/slack-import")({
  head: () => ({
    meta: [
      { title: "Canaux Slack — IZISuivis" },
      { name: "description", content: "Consulter les canaux Slack rapatriés dans IZISuivis et lire leurs messages." },
      { property: "og:title", content: "Canaux Slack — IZISuivis" },
      { property: "og:description", content: "Consulter les canaux Slack rapatriés et leurs messages." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const ok = roles?.some((r) => ["admin", "direction", "manager", "consultant"].includes(r.role as string));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: SlackImportPage,
});

function SlackImportPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Slack className="h-6 w-6" /> Canaux Slack
        </h1>
        <p className="text-sm text-muted-foreground">
          Canaux rapatriés depuis Slack et messages associés.
        </p>
      </header>

      <SlackCanauxExplorer />
    </div>
  );
}
