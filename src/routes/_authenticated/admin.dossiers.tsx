import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { categorieLabel, CATEGORIES } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/admin/dossiers")({
  head: () => ({ meta: [{ title: "Dossiers — Admin" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    if (!roles?.some((r) => r.role === "admin")) throw redirect({ to: "/dashboard" });
  },
  component: AdminDossiers,
});

function AdminDossiers() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-dossiers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("dossiers").select("*, profiles:client_id(nom,prenom,email)").order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const filtered = rows.filter((r: any) => {
    if (cat !== "all" && r.categorie !== cat) return false;
    if (!q.trim()) return true;
    const s = `${r.titre} ${r.profiles?.email} ${r.profiles?.nom} ${r.profiles?.prenom}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Tous les dossiers</h1>
        <p className="text-muted-foreground mt-1">{rows.length} au total</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-9" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">Toutes catégories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <Card className="divide-y">
        {filtered.map((d: any) => (
          <Link key={d.id} to="/dossiers/$id" params={{ id: d.id }} className="block p-4 hover:bg-muted/30">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs uppercase tracking-wider text-gold font-medium">{categorieLabel(d.categorie)}</span>
                  <StatusBadge statut={d.statut} />
                </div>
                <div className="font-medium truncate">{d.titre}</div>
                <div className="text-xs text-muted-foreground">
                  {d.profiles?.prenom} {d.profiles?.nom} · {d.profiles?.email} · {d.avancement}%
                </div>
              </div>
            </div>
          </Link>
        ))}
        {filtered.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">Aucun résultat.</div>}
      </Card>
    </div>
  );
}
