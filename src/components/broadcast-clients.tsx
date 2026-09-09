import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Megaphone, Paperclip, X, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { broadcastToClients } from "@/lib/broadcast.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

type ClientRow = { id: string; email: string | null; prenom: string | null; nom: string | null };

const sanitize = (name: string) =>
  name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "fichier";

export function BroadcastClients() {
  const { user } = useAuth();
  const run = useServerFn(broadcastToClients);

  const [titre, setTitre] = useState("");
  const [message, setMessage] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [allClients, setAllClients] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  const { data: staffIds = new Set<string>() } = useQuery({
    queryKey: ["staff-ids"],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "direction", "manager", "consultant"]);
      return new Set((data ?? []).map((r) => r.user_id as string));
    },
  });

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["broadcast-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, prenom, nom")
        .is("archived_at", null)
        .order("prenom", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ClientRow[];
    },
  });

  const clients = useMemo(
    () => profiles.filter((p) => !staffIds.has(p.id)),
    [profiles, staffIds],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      `${c.prenom ?? ""} ${c.nom ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q),
    );
  }, [clients, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const destinataires = allClients ? clients.length : selected.size;

  const envoyer = useMutation({
    mutationFn: async () => {
      // 1) Upload des pièces jointes (une seule fois, partagées entre destinataires)
      const attachments: { path: string; name: string; mime: string | null }[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        setProgress(`Envoi du fichier ${i + 1}/${files.length} — ${f.name}`);
        const path = `${user!.id}/diffusion/${crypto.randomUUID()}-${sanitize(f.name)}`;
        const { error } = await supabase.storage.from("chat-files").upload(path, f);
        if (error) throw error;
        attachments.push({ path, name: f.name, mime: f.type || null });
      }
      setProgress("Diffusion en cours…");
      return await run({
        data: {
          titre: titre.trim(),
          message: message.trim(),
          allClients,
          clientIds: allClients ? undefined : [...selected],
          attachments,
          sendEmail,
        },
      });
    },
    onSuccess: (res: any) => {
      setProgress(null);
      toast.success(
        `Diffusion envoyée à ${res.messagesEnvoyes} client(s)` +
          (sendEmail ? ` · ${res.emailsEnvoyes} e-mail(s)` : ""),
      );
      setTitre("");
      setMessage("");
      setFiles([]);
      setSelected(new Set());
      setAllClients(false);
    },
    onError: (e: any) => {
      setProgress(null);
      toast.error(e?.message ?? "Échec de la diffusion");
    },
  });

  const disabled =
    envoyer.isPending || !titre.trim() || !message.trim() || destinataires === 0;

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5"><Megaphone className="h-5 w-5 text-primary" /></div>
          <div>
            <h2 className="font-semibold">Envoyer à plusieurs clients</h2>
            <p className="text-xs text-muted-foreground">
              Le message est publié dans la messagerie de chaque client (notification incluse) et
              envoyé par e-mail individuel. Les fichiers sont accessibles via un lien sécurisé dans l'e-mail.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bc-titre">Objet</Label>
          <Input id="bc-titre" value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Ex : Information importante" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bc-msg">Message</Label>
          <Textarea id="bc-msg" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Votre message aux clients…" />
        </div>

        <div className="space-y-2">
          <Label>Pièces jointes</Label>
          <div className="flex items-center gap-2">
            <Input
              type="file"
              multiple
              className="max-w-sm"
              onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])].slice(0, 10))}
            />
            <Paperclip className="h-4 w-4 text-muted-foreground" />
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {files.map((f, i) => (
                <Badge key={`${f.name}-${i}`} variant="outline" className="gap-1">
                  {f.name}
                  <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={sendEmail} onCheckedChange={(v) => setSendEmail(v === true)} />
          Envoyer aussi par e-mail
        </label>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Destinataires</h2>
            <p className="text-xs text-muted-foreground">{destinataires} client(s) sélectionné(s)</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allClients} onCheckedChange={(v) => setAllClients(v === true)} />
            Tous les clients ({clients.length})
          </label>
        </div>

        {!allClients && (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Rechercher un client" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="max-h-80 overflow-auto divide-y rounded-md border">
              {isLoading ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Chargement…</div>
              ) : filtered.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Aucun client.</div>
              ) : (
                filtered.map((c) => (
                  <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
                    <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <span className="min-w-0 flex-1 truncate">
                      {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.email || "Client"}
                      <span className="text-xs text-muted-foreground"> · {c.email ?? "sans e-mail"}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(new Set(filtered.map((c) => c.id)))}>
                Tout sélectionner (affichés)
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Vider</Button>
            </div>
          </>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={() => envoyer.mutate()} disabled={disabled} className="gap-2">
            <Megaphone className="h-4 w-4" />
            {envoyer.isPending ? "Envoi…" : `Envoyer à ${destinataires} client(s)`}
          </Button>
          {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
        </div>
      </Card>
    </div>
  );
}
