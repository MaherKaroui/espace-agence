import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChatWindow } from "@/components/chat-window";
import { assertClientAccess } from "@/lib/admin-clients.functions";
import { usePresence, PresenceDot, PresenceLabel } from "@/components/presence-indicator";

export const Route = createFileRoute("/_authenticated/admin/messages/$clientId")({
  head: () => ({ meta: [{ title: "Conversation" }] }),
  beforeLoad: async ({ params }) => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => ["admin","direction","manager","consultant"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
    // Accès fin géré par RLS (client_in_scope) : on n'empêche plus l'accès
    // à la page ici pour éviter un redirect silencieux vers /admin/messages.
    try {
      await assertClientAccess({ data: { clientId: params.clientId } });
    } catch {
      // no-op : la page s'affichera et RLS filtrera les messages si hors périmètre.
    }
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
      <div className="flex items-center gap-2">
        <PresenceDot online={p?.online} />
        <div className="font-medium">{name}</div>
        <PresenceLabel row={p} />
      </div>
      <ChatWindow clientId={clientId} title={`Discussion avec ${name}`} />
    </div>
  );
}
