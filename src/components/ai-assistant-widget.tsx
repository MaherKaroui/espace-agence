import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bot, X, Send, RotateCcw, Loader2, CheckCircle2, FileText, HelpCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { categorieLabel } from "@/lib/labels";
import { assistantChat, assistantConfirmAction } from "@/lib/assistant.functions";
import { useRole } from "@/hooks/use-role";

const GUIDE_HINT_KEY = "izi.assistant.guide-hint.dismissed";


type Msg = { role: "user" | "assistant"; content: string };
type Proposal = any;

const WELCOME_CLIENT =
  "Bonjour, je suis l'assistant IZISuivis. Je peux vous indiquer l'état de vos demandes, les pièces qu'il vous reste à déposer, ou créer une nouvelle demande avec la liste des documents à fournir. Que souhaitez-vous faire ?";
const WELCOME_STAFF =
  "Salut, assistant IZISuivis. Je peux te donner l'état d'un dossier, les pièces manquantes, la vue portefeuille, ou préparer une demande, une pièce complémentaire ou une tâche. Dis-moi.";

export function AiAssistantWidget() {
  const { isStaff, loading } = useRole();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState<Proposal[]>([]);
  const [showGuideHint, setShowGuideHint] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chat = useServerFn(assistantChat);
  const confirmFn = useServerFn(assistantConfirmAction);

  const welcome = isStaff ? WELCOME_STAFF : WELCOME_CLIENT;

  useEffect(() => {
    if (!open) return;
    try {
      if (localStorage.getItem(GUIDE_HINT_KEY) !== "1") setShowGuideHint(true);
    } catch {
      /* stockage indisponible */
    }
  }, [open]);

  const dismissGuideHint = () => {
    setShowGuideHint(false);
    try {
      localStorage.setItem(GUIDE_HINT_KEY, "1");
    } catch {
      /* stockage indisponible */
    }
  };


  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, open]);

  const send = useMutation({
    mutationFn: async (history: Msg[]) => (await chat({ data: { messages: history } })) as any,
    onSuccess: (res) => {
      setMessages((m) => [...m, { role: "assistant", content: res.text || "…" }]);
      setPending(res.proposals ?? []);
    },
    onError: (e: any) => toast.error(e?.message ?? "L'assistant est indisponible."),
  });

  const confirm = useMutation({
    mutationFn: async (action: Proposal) => (await confirmFn({ data: { action } })) as any,
    onSuccess: (res, action) => {
      setPending([]);
      qc.invalidateQueries();
      if (action.kind === "creer_demande") {
        const lignes = (res.pieces ?? [])
          .map((p: any) => `• ${p.libelle}${p.motif ? ` — ${p.motif}` : ""}${p.obligatoire ? "" : " (facultatif)"}`)
          .join("\n");
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: `Demande créée : « ${res.titre} ».\nPièces à déposer :\n${lignes || "Aucune pièce référencée pour cette catégorie."}`,
          },
        ]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: "C'est enregistré." }]);
      }
      toast.success("Action enregistrée.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Action refusée."),
  });

  const submit = () => {
    const text = input.trim();
    if (!text || send.isPending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setPending([]);
    setInput("");
    send.mutate(next);
  };

  const reset = () => {
    setMessages([]);
    setPending([]);
    setInput("");
  };

  if (loading) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          aria-label="Ouvrir l'assistant IA"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-[calc(96px+var(--safe-bottom))] lg:bottom-6 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-sidebar text-sidebar-foreground shadow-lg ring-1 ring-primary/30 transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Bot className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Assistant IZISuivis"
          className={cn(
            "fixed z-[65] flex flex-col bg-background shadow-2xl",
            "inset-0 lg:inset-auto lg:right-6 lg:bottom-6 lg:h-[620px] lg:w-[420px] lg:rounded-xl lg:border",
          )}
        >
          <header className="flex items-center gap-2 border-b px-4 py-3 pt-safe lg:pt-3">
            <Bot className="h-5 w-5 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="font-display text-base leading-tight">Assistant IZISuivis</div>
              <div className="truncate text-xs text-muted-foreground">
                {isStaff ? "Profil agence" : "Profil client"} · réponses basées sur vos données
              </div>
            </div>
            <Button variant="ghost" size="icon" aria-label="Nouvelle conversation" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Fermer l'assistant" onClick={() => setOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            <div className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{welcome}</div>
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                  m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {m.content}
              </div>
            ))}
            {send.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> L'assistant consulte vos données…
              </div>
            )}
            {pending.map((p, i) => (
              <ConfirmationCard
                key={i}
                proposal={p}
                busy={confirm.isPending}
                onCancel={() => setPending((list) => list.filter((_, j) => j !== i))}
                onConfirm={() => confirm.mutate(p)}
              />
            ))}
          </div>

          <div className="border-t p-3 pb-[calc(12px+var(--safe-bottom))] lg:pb-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                aria-label="Votre message"
                placeholder={isStaff ? "Ex : état du dossier Qualiopi de…" : "Ex : je veux faire une demande de NDA"}
                className="max-h-32 min-h-[42px] resize-none"
              />
              <Button size="icon" aria-label="Envoyer" onClick={submit} disabled={send.isPending || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ConfirmationCard({
  proposal,
  onConfirm,
  onCancel,
  busy,
}: {
  proposal: Proposal;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  if (proposal.kind === "rediger_message") {
    return (
      <Card className="border-primary/30 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4 text-primary" /> Brouillon (non envoyé)
        </div>
        {proposal.objet && <div className="text-sm font-medium">{proposal.objet}</div>}
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.brouillon}</p>
      </Card>
    );
  }

  return (
    <Card className="border-primary/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 className="h-4 w-4 text-primary" /> Confirmation requise
      </div>
      {proposal.kind === "creer_demande" && (
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Catégorie : </span>
            {categorieLabel(proposal.categorie)}
          </div>
          <div>
            <span className="text-muted-foreground">Organisme : </span>
            {proposal.organisme_nom}
          </div>
          <div className="text-muted-foreground">Statut initial : En attente</div>
          <div>
            <div className="mb-1 text-muted-foreground">Pièces qui seront demandées :</div>
            <ul className="space-y-1">
              {(proposal.pieces ?? []).map((p: any, i: number) => (
                <li key={i} className="rounded border px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.libelle}</span>
                    {!p.obligatoire && (
                      <Badge variant="outline" className="text-[10px]">
                        facultatif
                      </Badge>
                    )}
                  </div>
                  {p.motif && <div className="text-xs text-muted-foreground">{p.motif}</div>}
                </li>
              ))}
              {(proposal.pieces ?? []).length === 0 && (
                <li className="text-xs text-muted-foreground">Aucune pièce référencée pour cette catégorie.</li>
              )}
            </ul>
          </div>
        </div>
      )}
      {proposal.kind === "demander_piece" && (
        <div className="space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">Dossier : </span>
            {proposal.dossier_titre}
          </div>
          <div>
            <span className="text-muted-foreground">Pièce demandée : </span>
            {proposal.libelle}
          </div>
          {proposal.motif && <div className="text-xs text-muted-foreground">{proposal.motif}</div>}
        </div>
      )}
      {proposal.kind === "creer_tache" && (
        <div className="space-y-1 text-sm">
          <div className="font-medium">{proposal.title}</div>
          {proposal.description && <div className="text-muted-foreground">{proposal.description}</div>}
          <div className="text-xs text-muted-foreground">
            Priorité : {proposal.priority}
            {proposal.due_date ? ` · Échéance : ${proposal.due_date}` : ""}
          </div>
        </div>
      )}
      {proposal.kind === "changer_statut_tache" && (
        <div className="space-y-1 text-sm">
          <div className="font-medium">{proposal.task_titre}</div>
          <div className="text-muted-foreground">Nouveau statut : {proposal.statut}</div>
        </div>
      )}
      {proposal.kind === "assigner_tache" && (
        <div className="space-y-1 text-sm">
          <div className="font-medium">{proposal.task_titre}</div>
          <div className="text-muted-foreground">Assignée à : {proposal.user_nom}</div>
        </div>
      )}
      {proposal.kind === "modifier_echeance_tache" && (
        <div className="space-y-1 text-sm">
          <div className="font-medium">{proposal.task_titre}</div>
          <div className="text-muted-foreground">Nouvelle échéance : {proposal.due_date ?? "aucune"}</div>
        </div>
      )}
      {proposal.kind === "commenter_tache" && (
        <div className="space-y-1 text-sm">
          <div className="font-medium">{proposal.task_titre}</div>
          <div className="whitespace-pre-wrap text-muted-foreground">{proposal.contenu}</div>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onConfirm} disabled={busy}>
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Confirmer
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
      </div>
    </Card>
  );
}
