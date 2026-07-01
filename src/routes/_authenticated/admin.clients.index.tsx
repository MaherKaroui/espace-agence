import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, User } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/clients/")({
  head: () => ({ meta: [{ title: "Clients — Admin" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    if (!roles?.some((r) => r.role === "admin")) throw redirect({ to: "/dashboard" });
  },
  component: AdminClients,
});

function AdminClients() {
  const [q, setQ] = useState("");
  const { data: clients = [] } = useQuery({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const filtered = clients.filter((c) => {
    const s = `${c.prenom} ${c.nom} ${c.email}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Clients</h1>
        <p className="text-muted-foreground mt-1">{clients.length} inscrit(s)</p>
      </div>
      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
        <Input placeholder="Rechercher par nom ou e-mail…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card className="divide-y">
        {filtered.map((c) => (
          <Link key={c.id} to="/admin/clients/$id" params={{ id: c.id }} className="flex items-center gap-3 p-4 hover:bg-muted/30">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{c.prenom} {c.nom}</div>
              <div className="text-xs text-muted-foreground truncate">{c.email}</div>
            </div>
          </Link>
        ))}
        {filtered.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">Aucun résultat.</div>}
      </Card>
    </div>
  );
}
