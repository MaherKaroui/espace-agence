import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LEGAL_LABELS } from "@/lib/legal-versions";
import { ShieldAlert, FileText, Loader2, CheckCircle2, Search, Download } from "lucide-react";
import { Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/rgpd")({
  head: () => ({ meta: [{ title: "RGPD — Administration" }] }),
  component: AdminRgpdPage,
});

function AdminRgpdPage() {
  const { isAdmin, loading } = useRole();
  const qc = useQueryClient();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [searchReq, setSearchReq] = useState("");
  const [searchCons, setSearchCons] = useState("");

  const { data: requests } = useQuery({
    queryKey: ["admin-deletion-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deletion_requests")
        .select("*, profile:profiles!deletion_requests_user_id_fkey(id, nom, prenom, email)")
        .order("requested_at", { ascending: false });
      // Le foreign key n'existe pas, on récupère les profils séparément
      if (error) {
        const { data: fallback } = await supabase
          .from("deletion_requests")
          .select("*")
          .order("requested_at", { ascending: false });
        return fallback ?? [];
      }
      return data;
    },
    enabled: isAdmin,
  });

  // Profils associés (jointure côté client faute de FK)
  const userIds = (requests ?? []).map((r: any) => r.user_id);
  const { data: profilesMap } = useQuery({
    queryKey: ["profiles-for-deletion", userIds.sort().join(",")],
    queryFn: async () => {
      if (userIds.length === 0) return {} as Record<string, any>;
      const { data } = await supabase.from("profiles").select("id, nom, prenom, email").in("id", userIds);
      const m: Record<string, any> = {};
      (data ?? []).forEach((p) => { m[p.id] = p; });
      return m;
    },
    enabled: userIds.length > 0,
  });

  const { data: consentsCount } = useQuery({
    queryKey: ["admin-consents-count"],
    queryFn: async () => {
      const { count } = await supabase.from("consents").select("*", { count: "exact", head: true });
      return count ?? 0;
    },
    enabled: isAdmin,
  });

  const { data: recentConsents } = useQuery({
    queryKey: ["admin-consents-recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("consents")
        .select("*")
        .order("accepted_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
    enabled: isAdmin,
  });

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" />;

  const pending = (requests ?? []).filter((r: any) => r.status === "pending");
  const processed = (requests ?? []).filter((r: any) => r.status !== "pending");

  const handleProcess = async (req: any) => {
    if (!confirm("Confirmer l'anonymisation du compte ? Cette action est irréversible.")) return;
    setProcessingId(req.id);
    // Enregistre les notes avant anonymisation
    if (notes[req.id]) {
      await supabase.from("deletion_requests").update({ admin_notes: notes[req.id] }).eq("id", req.id);
    }
    const { error } = await supabase.rpc("anonymize_user_account", { _user_id: req.user_id });
    setProcessingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Compte anonymisé et demande marquée comme traitée.");
    qc.invalidateQueries({ queryKey: ["admin-deletion-requests"] });
    qc.invalidateQueries({ queryKey: ["profiles-for-deletion"] });
  };

  return (
    <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="font-display text-3xl">Conformité RGPD</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Demandes de suppression, registre des consentements.
          </p>
        </div>

        <Tabs defaultValue="requests">
          <TabsList>
            <TabsTrigger value="requests">
              Demandes de suppression {pending.length > 0 && <Badge variant="destructive" className="ml-2">{pending.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="consents">
              Registre des consentements {consentsCount != null && <Badge variant="secondary" className="ml-2">{consentsCount}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="requests" className="mt-4 space-y-4">
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <h2 className="font-display text-lg">En attente ({pending.length})</h2>
              </div>
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune demande en attente.</p>
              ) : (
                <div className="space-y-3">
                  {pending.map((r: any) => {
                    const p = profilesMap?.[r.user_id];
                    return (
                      <div key={r.id} className="border rounded-md p-4">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div>
                            <div className="font-medium">
                              {p ? `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email : r.user_id}
                            </div>
                            <div className="text-xs text-muted-foreground">{p?.email}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Demande reçue le {new Date(r.requested_at).toLocaleString("fr-FR")}
                            </div>
                            {r.reason && (
                              <div className="mt-2 text-sm bg-muted/50 rounded p-2">Motif : {r.reason}</div>
                            )}
                          </div>
                          <Badge variant="destructive">En attente</Badge>
                        </div>
                        <div className="mt-3">
                          <Textarea
                            placeholder="Notes internes (facultatif)…"
                            value={notes[r.id] ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                            rows={2}
                          />
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleProcess(r)}
                            disabled={processingId === r.id}
                          >
                            {processingId === r.id && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Traiter (anonymiser)
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <h2 className="font-display text-lg">Historique ({processed.length})</h2>
              </div>
              {processed.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune demande traitée.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {processed.map((r: any) => {
                    const p = profilesMap?.[r.user_id];
                    return (
                      <div key={r.id} className="flex items-center justify-between border rounded-md p-3">
                        <div>
                          <div className="font-medium">
                            {p ? `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email : r.user_id}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Demande le {new Date(r.requested_at).toLocaleDateString("fr-FR")}
                            {r.processed_at && ` — Traitée le ${new Date(r.processed_at).toLocaleDateString("fr-FR")}`}
                          </div>
                        </div>
                        <Badge variant={r.status === "processed" ? "secondary" : "outline"}>
                          {r.status === "processed" ? "Traitée" : "Annulée"}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="consents" className="mt-4">
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-4 w-4 text-primary" />
                <h2 className="font-display text-lg">50 derniers consentements</h2>
              </div>
              {!recentConsents || recentConsents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun consentement enregistré.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground text-xs uppercase">
                      <tr className="border-b">
                        <th className="py-2 pr-2">Utilisateur</th>
                        <th className="py-2 pr-2">Document</th>
                        <th className="py-2 pr-2">Version</th>
                        <th className="py-2 pr-2">Date</th>
                        <th className="py-2 pr-2">IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentConsents.map((c) => (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="py-2 pr-2 font-mono text-xs">{c.user_id.slice(0, 8)}…</td>
                          <td className="py-2 pr-2">{LEGAL_LABELS[c.document_type as keyof typeof LEGAL_LABELS] ?? c.document_type}</td>
                          <td className="py-2 pr-2">{c.version}</td>
                          <td className="py-2 pr-2">{new Date(c.accepted_at).toLocaleString("fr-FR")}</td>
                          <td className="py-2 pr-2 text-xs text-muted-foreground">{c.ip ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
    </div>
  );
}
