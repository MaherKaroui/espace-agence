import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChatWindow } from "@/components/chat-window";
import { usePresence, PresenceDot, PresenceLabel } from "@/components/presence-indicator";
import { ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/messages/$clientId")({
  head: () => ({ meta: [{ title: "Conversation" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => ["admin","direction","manager","consultant"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminChat,
});

function AdminChat() {
  const { clientId } = Route.useParams();
  const { data: profile } = useQuery({
    queryKey: ["profile", clientId],
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", clientId).maybeSingle()).data,
  });
  const { data: presence } = usePresence([clientId]);
  const p = presence?.get(clientId);
  const name = profile ? `${profile.prenom ?? ""} ${profile.nom ?? ""}`.trim() || profile.email : "Discussion";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <PresenceDot online={p?.online} />
        <Link
          to="/admin/clients/$id"
          params={{ id: clientId }}
          className="font-medium text-primary hover:underline inline-flex items-center gap-1"
          title="Voir la fiche client"
        >
          {name}
          <ExternalLink className="h-3.5 w-3.5 opacity-70" />
        </Link>
        <PresenceLabel row={p} />
      </div>
      <ChatWindow clientId={clientId} title={`Discussion avec ${name}`} />
    </div>
  );
}
