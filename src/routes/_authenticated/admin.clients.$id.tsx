import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { categorieLabel } from "@/lib/labels";
import { ArrowLeft, MessageSquare, Building2, Phone, Mail, StickyNote, Trash2, Loader2, FolderOpen, CheckCircle2, Clock, Archive, ArchiveRestore, Activity, FileText, CalendarCheck, ListChecks } from "lucide-react";
import { RelanceButton } from "@/components/relance-button";


import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useServerFn } from "@tanstack/react-start";
import { archiveClient, unarchiveClient, assertClientAccess, updateClientProfile } from "@/lib/admin-clients.functions";
import { formatDistanceToNow, format } from "date-fns";
import { fr } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/admin/clients/$id")({
  head: () => ({ meta: [{ title: "Client — Admin" }] }),
  beforeLoad: async ({ params }) => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const staff = roles?.some((r) => ["admin", "direction", "manager", "consultant"].includes(r.role));
    if (!staff) throw redirect({ to: "/dashboard" });
    // Vérif serveur : ce client est-il dans mon périmètre de pôles ?
    try {
      await assertClientAccess({ data: { clientId: params.id } });
    } catch {
      throw redirect({ to: "/admin/clients" });
    }
  },
  component: ClientDetail,
});

function ClientDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile", id],
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", id).maybeSingle()).data,
  });

  const { data: dossiers = [] } = useQuery({
    queryKey: ["dossiers-client", id],
    queryFn: async () =>
      (await supabase.from("dossiers").select("*").eq("client_id", id).order("updated_at", { ascending: false })).data ?? [],
  });

  const { data: docsCount = 0 } = useQuery({
    queryKey: ["docs-count-client", id],
    queryFn: async () => {
      const dossierIds = (dossiers ?? []).map((d: any) => d.id);
      if (dossierIds.length === 0) return 0;
      const { count } = await supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .in("dossier_id", dossierIds);
      return count ?? 0;
    },
    enabled: dossiers.length > 0,
  });

  const { data: lastMsg } = useQuery({
    queryKey: ["last-msg-client", id],
    queryFn: async () =>
      (await supabase
        .from("messages")
        .select("created_at,from_agence")
        .eq("client_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()).data,
  });

  const { data: notes = [] } = useQuery({
    queryKey: ["client-notes", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("client_notes")
        .select("id, contenu, author_id, created_at")
        .eq("client_id", id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const authorIds = Array.from(new Set(notes.map((n: any) => n.author_id).filter(Boolean)));
  const { data: authors = [] } = useQuery({
    queryKey: ["client-notes-authors", id, authorIds.join(",")],
    queryFn: async () => {
      if (authorIds.length === 0) return [];
      const { data } = await supabase.from("profiles").select("id,prenom,nom").in("id", authorIds);
      return data ?? [];
    },
    enabled: authorIds.length > 0,
  });
  const authorLabel = (uid: string) => {
    const a = authors.find((p: any) => p.id === uid);
    return a ? `${a.prenom} ${a.nom}`.trim() || "Membre agence" : "Membre agence";
  };

  const dossierIds = (dossiers ?? []).map((d: any) => d.id);
  const { data: timeline = [] } = useQuery({
    queryKey: ["client-timeline", id, dossierIds.join(",")],
    enabled: !!profile,
    queryFn: async () => {
      const events: Array<{ type: "message" | "document" | "tache" | "rdv"; at: string; label: string; sub?: string; dossierId?: string }> = [];
      const { data: msgs } = await supabase
        .from("messages")
        .select("id, contenu, created_at, from_agence, dossier_id")
        .eq("client_id", id)
        .order("created_at", { ascending: false })
        .limit(15);
      for (const m of (msgs ?? []) as any[]) {
        events.push({
          type: "message",
          at: m.created_at,
          label: m.from_agence ? "Message agence" : "Message client",
          sub: (m.contenu ?? "").slice(0, 140),
          dossierId: m.dossier_id ?? undefined,
        });
      }
      if (dossierIds.length > 0) {
        const { data: docs } = await supabase
          .from("documents")
          .select("id, nom, created_at, dossier_id")
          .in("dossier_id", dossierIds)
          .order("created_at", { ascending: false })
          .limit(15);
        for (const d of (docs ?? []) as any[]) {
          events.push({ type: "document", at: d.created_at, label: "Document déposé", sub: d.nom, dossierId: d.dossier_id });
        }
        const { data: tks } = await supabase
          .from("taches")
          .select("id, titre, completed_at, dossier_id")
          .in("dossier_id", dossierIds)
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })
          .limit(15);
        for (const t of (tks ?? []) as any[]) {
          events.push({ type: "tache", at: t.completed_at, label: "Tâche terminée", sub: t.titre, dossierId: t.dossier_id });
        }
      }
      const { data: rdvs } = await supabase
        .from("rendez_vous")
        .select("id, starts_at, status, notes, dossier_id")
        .eq("client_id", id)
        .order("starts_at", { ascending: false })
        .limit(10);
      for (const r of (rdvs ?? []) as any[]) {
        events.push({
          type: "rdv",
          at: r.starts_at,
          label: `Rendez-vous ${r.status === "confirmed" ? "confirmé" : r.status === "cancelled" ? "annulé" : "proposé"}`,
          sub: r.notes ?? undefined,
          dossierId: r.dossier_id ?? undefined,
        });
      }
      return events.filter((e) => e.at).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 20);
    },
  });


  const [telephone, setTelephone] = useState<string | null>(null);
  const [entreprise, setEntreprise] = useState<string | null>(null);
  const [prenom, setPrenom] = useState<string | null>(null);
  const [nom, setNom] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const updateProfile = useMutation({
    mutationFn: async (patch: { telephone?: string | null; entreprise?: string | null }) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fiche mise à jour");
      qc.invalidateQueries({ queryKey: ["profile", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateIdentityFn = useServerFn(updateClientProfile);
  const updateIdentity = useMutation({
    mutationFn: async (patch: { prenom?: string; nom?: string; email?: string }) =>
      updateIdentityFn({ data: { userId: id, ...patch } }),
    onSuccess: () => {
      toast.success("Identité mise à jour");
      qc.invalidateQueries({ queryKey: ["profile", id] });
      qc.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { isAdmin, isDirectionOrAdmin } = useRole();
  const [archiveReason, setArchiveReason] = useState("");
  const archiveFn = useServerFn(archiveClient);
  const unarchiveFn = useServerFn(unarchiveClient);
  const archiveM = useMutation({
    mutationFn: async () => archiveFn({ data: { userId: id, reason: archiveReason || undefined } }),
    onSuccess: () => {
      toast.success("Client archivé");
      qc.invalidateQueries({ queryKey: ["admin-clients"] });
      qc.invalidateQueries({ queryKey: ["profile", id] });
      nav({ to: "/admin/clients" });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const unarchiveM = useMutation({
    mutationFn: async () => unarchiveFn({ data: { userId: id } }),
    onSuccess: () => {
      toast.success("Client réactivé");
      qc.invalidateQueries({ queryKey: ["admin-clients"] });
      qc.invalidateQueries({ queryKey: ["profile", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const isArchived = !!(profile as any)?.archived_at;

  const [newNote, setNewNote] = useState("");
  const addNote = useMutation({
    mutationFn: async (contenu: string) => {
      const { error } = await supabase
        .from("client_notes")
        .insert({ client_id: id, author_id: user!.id, contenu });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Note ajoutée");
      setNewNote("");
      qc.invalidateQueries({ queryKey: ["client-notes", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delNote = useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await supabase.from("client_notes").delete().eq("id", noteId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Note supprimée");
      qc.invalidateQueries({ queryKey: ["client-notes", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const nbActifs = dossiers.filter((d: any) => !["termine", "annule"].includes(d.statut)).length;
  const nbTermines = dossiers.filter((d: any) => d.statut === "termine").length;

  const currentTel = telephone ?? (profile as any)?.telephone ?? "";
  const currentEnt = entreprise ?? (profile as any)?.entreprise ?? "";
  const currentPrenom = prenom ?? profile?.prenom ?? "";
  const currentNom = nom ?? profile?.nom ?? "";
  const currentEmail = email ?? profile?.email ?? "";

  return (
    <div className="space-y-6">
      <button onClick={() => nav({ to: "/admin/clients" })} className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Retour
      </button>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl">{profile?.prenom} {profile?.nom}</h1>
            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2"><Mail className="h-4 w-4" /> {profile?.email}</div>
              {(profile as any)?.telephone && (
                <div className="flex items-center gap-2"><Phone className="h-4 w-4" /> {(profile as any).telephone}</div>
              )}
              {(profile as any)?.entreprise && (
                <div className="flex items-center gap-2"><Building2 className="h-4 w-4" /> {(profile as any).entreprise}</div>
              )}
              {profile?.created_at && (
                <div className="text-xs">Inscrit {formatDistanceToNow(new Date(profile.created_at), { addSuffix: true, locale: fr })}</div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/messages/$clientId" params={{ clientId: id }}>
              <Button variant="outline"><MessageSquare className="h-4 w-4 mr-2" /> Ouvrir la conversation</Button>
            </Link>
            <RelanceButton clientId={id} clientEmail={profile?.email} />

            {isDirectionOrAdmin && !isArchived && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={archiveM.isPending}>
                    {archiveM.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Archive className="h-4 w-4 mr-2" />}
                    Archiver le client
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archiver ce client&nbsp;?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Le client sera <strong>archivé</strong> : ses sessions sont fermées et son compte n'apparaît plus dans les listes. Les dossiers et l'historique restent conservés. Seul un administrateur peut le réactiver.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="mt-2">
                    <label className="text-xs text-muted-foreground">Motif (optionnel)</label>
                    <Textarea rows={2} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} placeholder="Ex. Dossiers clôturés — RGPD" />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={() => archiveM.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Archiver
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {isAdmin && isArchived && (
              <Button variant="outline" onClick={() => unarchiveM.mutate()} disabled={unarchiveM.isPending}>
                {unarchiveM.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArchiveRestore className="h-4 w-4 mr-2" />}
                Réactiver le client
              </Button>
            )}
          </div>
        </div>
        {isArchived && (
          <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            Client archivé le {(profile as any)?.archived_at ? format(new Date((profile as any).archived_at), "d MMM yyyy", { locale: fr }) : ""}
            {(profile as any)?.archive_reason ? ` — ${(profile as any).archive_reason}` : ""}.
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Kpi icon={FolderOpen} label="Dossiers" value={String(dossiers.length)} tone="bg-primary/10 text-primary" />
          <Kpi icon={Clock} label="Actifs" value={String(nbActifs)} tone="bg-info/15 text-info" />
          <Kpi icon={CheckCircle2} label="Terminés" value={String(nbTermines)} tone="bg-success/15 text-success" />
          <Kpi
            icon={MessageSquare}
            label="Dernier message"
            value={
              lastMsg
                ? `${lastMsg.from_agence ? "Agence" : "Client"} · ${formatDistanceToNow(new Date(lastMsg.created_at), { addSuffix: true, locale: fr })}`
                : "—"
            }
            tone="bg-muted text-muted-foreground"
            small
          />
        </div>

        <div className="mt-6 pt-6 border-t grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-muted-foreground">Prénom</label>
            <Input
              value={currentPrenom}
              onChange={(e) => setPrenom(e.target.value)}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== (profile?.prenom ?? "")) updateIdentity.mutate({ prenom: v });
              }}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Nom</label>
            <Input
              value={currentNom}
              onChange={(e) => setNom(e.target.value)}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== (profile?.nom ?? "")) updateIdentity.mutate({ nom: v });
              }}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">E-mail</label>
            <Input
              type="email"
              value={currentEmail}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== (profile?.email ?? "")) updateIdentity.mutate({ email: v });
              }}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Téléphone</label>
            <Input
              placeholder="+33 …"
              value={currentTel}
              onChange={(e) => setTelephone(e.target.value)}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== ((profile as any)?.telephone ?? null)) updateProfile.mutate({ telephone: v });
              }}
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">Entreprise</label>
            <Input
              placeholder="Nom de l'organisme"
              value={currentEnt}
              onChange={(e) => setEntreprise(e.target.value)}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== ((profile as any)?.entreprise ?? null)) updateProfile.mutate({ entreprise: v });
              }}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground/70 mt-1">Docs déposés : {docsCount}</p>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <StickyNote className="h-5 w-5 text-warning" />
          <h2 className="font-display text-xl">Notes internes agence</h2>
          <span className="text-xs text-muted-foreground">— non visibles par le client</span>
        </div>
        <div className="space-y-2 mb-4">
          <Textarea
            rows={3}
            placeholder="Ajouter une note interne (contexte, historique, prochaines démarches…)"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => newNote.trim() && addNote.mutate(newNote.trim())}
              disabled={addNote.isPending || !newNote.trim()}
            >
              {addNote.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Ajouter la note
            </Button>
          </div>
        </div>
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Aucune note pour l'instant.</p>
        ) : (
          <ul className="divide-y">
            {notes.map((n: any) => (
              <li key={n.id} className="py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm whitespace-pre-wrap">{n.contenu}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {authorLabel(n.author_id)} · {format(new Date(n.created_at), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
                  </p>
                </div>
                {n.author_id === user?.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => delNote.mutate(n.id)}
                    disabled={delNote.isPending}
                    aria-label="Supprimer la note"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="font-display text-xl">Historique récent</h2>
          <span className="text-xs text-muted-foreground">— 20 dernières activités tous dossiers</span>
        </div>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Aucune activité pour l'instant.</p>
        ) : (
          <ul className="divide-y">
            {timeline.map((e, i) => {
              const Icon = e.type === "message" ? MessageSquare : e.type === "document" ? FileText : e.type === "tache" ? ListChecks : CalendarCheck;
              const tone = e.type === "message" ? "bg-primary/10 text-primary" : e.type === "document" ? "bg-info/15 text-info" : e.type === "tache" ? "bg-success/15 text-success" : "bg-warning/15 text-warning";
              return (
                <li key={`${e.type}-${i}-${e.at}`} className="py-3 flex items-start gap-3">
                  <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 ${tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{e.label}</div>
                    {e.sub && <div className="text-xs text-muted-foreground truncate">{e.sub}</div>}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(e.at), { addSuffix: true, locale: fr })}
                      {e.dossierId && (
                        <> · <Link to="/dossiers/$id" params={{ id: e.dossierId }} className="underline hover:text-foreground">voir le dossier</Link></>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div>
        <h2 className="font-display text-xl mb-3">Dossiers ({dossiers.length})</h2>
        {dossiers.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">Aucun dossier.</Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {dossiers.map((d: any) => (
              <Link key={d.id} to="/dossiers/$id" params={{ id: d.id }}>
                <Card className="p-4 hover:border-primary/40 transition">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs uppercase tracking-wider text-gold font-medium">{categorieLabel(d.categorie)}</span>
                    <StatusBadge statut={d.statut} />
                  </div>
                  <div className="font-medium">{d.titre}</div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                    <span>Avancement : {d.avancement}%</span>
                    {d.updated_at && (
                      <span>{formatDistanceToNow(new Date(d.updated_at), { addSuffix: true, locale: fr })}</span>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
  small,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3 flex items-start gap-3">
      <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 ${tone}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={small ? "text-xs font-medium truncate" : "text-lg font-semibold"}>{value}</div>
      </div>
    </div>
  );
}
