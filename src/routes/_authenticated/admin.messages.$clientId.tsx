import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChatWindow } from "@/components/chat-window";

export const Route = createFileRoute("/_authenticated/admin/messages/$clientId")({
  head: () => ({ meta: [{ title: "Conversation" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    if (!roles?.some((r) => r.role === "admin")) throw redirect({ to: "/dashboard" });
  },
  component: AdminChat,
});

function AdminChat() {
  const { clientId } = Route.useParams();
  const { data: profile } = useQuery({
    queryKey: ["profile", clientId],
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", clientId).maybeSingle()).data,
  });
  const title = profile ? `Discussion avec ${profile.prenom} ${profile.nom}` : "Discussion";
  return <ChatWindow clientId={clientId} title={title} />;
}
