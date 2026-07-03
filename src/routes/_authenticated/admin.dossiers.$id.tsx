import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/dossiers/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/dossiers/$id", params: { id: params.id } });
  },
});
