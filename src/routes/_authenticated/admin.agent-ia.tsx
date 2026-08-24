import { createFileRoute, redirect } from "@tanstack/react-router";

// Route conservée pour ne pas casser les liens existants (e-mails, notifications).
// Redirige vers la page regroupée « Rapport et IA » sur le bon onglet.
export const Route = createFileRoute("/_authenticated/admin/agent-ia")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/rapport-et-ia", search: { onglet: "agent-ia" } });
  },
});
