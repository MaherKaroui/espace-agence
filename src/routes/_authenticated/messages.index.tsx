import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { ChatWindow } from "@/components/chat-window";

export const Route = createFileRoute("/_authenticated/messages/")({
  head: () => ({ meta: [{ title: "Messagerie" }] }),
  component: MessagesPage,
});

function MessagesPage() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  if (!user) return null;
  if (isAdmin) return <div className="p-8 text-muted-foreground">Utilisez « Messagerie agence » dans la barre latérale pour choisir un client.</div>;
  return <ChatWindow clientId={user.id} />;
}
