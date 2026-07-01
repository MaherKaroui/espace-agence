import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ChatWindow } from "@/components/chat-window";

export const Route = createFileRoute("/_authenticated/messages/")({
  head: () => ({ meta: [{ title: "Messagerie" }] }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const isStaff = roles?.some((r) => ["admin", "direction", "manager", "consultant"].includes(r.role));
    if (isStaff) throw redirect({ to: "/admin/messages" });
  },
  component: MessagesPage,
});

function MessagesPage() {
  const { user } = useAuth();
  if (!user) return null;
  return <ChatWindow clientId={user.id} />;
}
