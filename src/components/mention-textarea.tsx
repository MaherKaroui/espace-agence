import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { searchMentionCandidates } from "@/lib/mention-search.functions";
import { Textarea } from "@/components/ui/textarea";
import { AtSign, Hash, User, Building2, FolderOpen, ClipboardCheck, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseMentionSegments } from "@/lib/mentions";

type EntityKind = "client" | "dossier" | "task" | "pole";
type Kind = "user" | EntityKind;
type Candidate = { id: string; label: string; sublabel?: string; kind: Kind };

const ENTITY_KINDS: EntityKind[] = ["client", "dossier", "task", "pole"];

const KIND_ICON: Record<Kind, any> = {
  user: User,
  client: Building2,
  dossier: FolderOpen,
  task: ClipboardCheck,
  pole: Users,
};

const KIND_LABEL: Record<Kind, string> = {
  user: "Personne",
  client: "Client",
  dossier: "Dossier",
  task: "Tâche",
  pole: "Pôle",
};

/**
 * Zone de saisie avec autocomplete :
 * - `@` : personnes (toujours actif)
 * - `#` : entités liées (clients / dossiers / tâches / pôles), si `enableEntities`.
 */
export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  conversationId,
  scopeClientId,
  placeholder,
  rows = 2,
  disabled,
  enableEntities = false,
  enableUsers = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  conversationId?: string;
  scopeClientId?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  enableEntities?: boolean;
  enableUsers?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const search = useServerFn(searchMentionCandidates);
  const [trigger, setTrigger] = useState<null | { start: number; query: string; type: "user" | "entity" }>(null);
  const [items, setItems] = useState<Candidate[]>([]);
  const [active, setActive] = useState(0);

  // Texte affiché à l'utilisateur : « @Nom » / « #Nom » lisibles, sans identifiants.
  const [display, setDisplay] = useState("");
  // Mémoire des mentions choisies : libellé affiché → identifiant réel.
  const registry = useRef<Map<string, { id: string; kind: Kind }>>(new Map());

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** Convertit le texte lisible en contenu balisé (tokens avec ids). */
  const encode = (text: string) => {
    let out = text;
    const entries = Array.from(registry.current.entries()).sort((a, b) => b[0].length - a[0].length);
    for (const [label, m] of entries) {
      const prefix = m.kind === "user" ? "@" : "#";
      const token = m.kind === "user" ? `@[${label}](user:${m.id})` : `#[${label}](${m.kind}:${m.id})`;
      out = out.split(`${prefix}${label}`).join(token);
    }
    return out;
  };

  /** Convertit un contenu balisé en texte lisible (et réenregistre les mentions). */
  const decode = (text: string) =>
    text
      .replace(/@\[([^\]]+)\]\(user:([0-9a-fA-F-]+)\)/g, (_m, label: string, id: string) => {
        registry.current.set(label, { id, kind: "user" });
        return `@${label}`;
      })
      .replace(/#\[([^\]]+)\]\((client|dossier|task|pole):([0-9a-fA-F-]+)\)/g, (_m, label: string, kind: string, id: string) => {
        registry.current.set(label, { id, kind: kind as Kind });
        return `#${label}`;
      });

  // Synchronise si le parent réinitialise ou fixe la valeur de l'extérieur.
  useEffect(() => {
    if (encode(display) !== value) setDisplay(decode(value));
    if (!value) registry.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const detectTrigger = (text: string, caret: number) => {
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === " " || ch === "\n" || ch === "\t") return null;
      if (ch === "@" && enableUsers) return { start: i, query: text.slice(i + 1, caret), type: "user" as const };
      if (ch === "#" && enableEntities)
        return { start: i, query: text.slice(i + 1, caret), type: "entity" as const };
    }
    return null;
  };

  const handleChange = (v: string) => {
    setDisplay(v);
    onChange(encode(v));
    const el = ref.current;
    const caret = el?.selectionStart ?? v.length;
    setTrigger(detectTrigger(v, caret));
    setActive(0);
  };

  useEffect(() => {
    if (!trigger) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const kinds: Kind[] = trigger.type === "user" ? ["user"] : ENTITY_KINDS;
    Promise.all(
      kinds.map((k) =>
        search({ data: { kind: k, query: trigger.query, conversationId, scopeClientId } })
          .then((rows: any) => (rows as any[]).map((r) => ({ ...r, kind: k })))
          .catch(() => [] as Candidate[]),
      ),
    ).then((results) => {
      if (cancelled) return;
      const merged = results.flat().slice(0, 8) as Candidate[];
      setItems(merged);
    });
    return () => {
      cancelled = true;
    };
  }, [trigger?.query, trigger?.type, conversationId, scopeClientId, search]);

  const insertMention = (c: Candidate) => {
    if (!trigger) return;
    registry.current.set(c.label, { id: c.id, kind: c.kind });
    const before = display.slice(0, trigger.start);
    const after = display.slice(ref.current?.selectionStart ?? display.length);
    const visible = `${c.kind === "user" ? "@" : "#"}${c.label} `;
    const next = `${before}${visible}${after}`;
    setDisplay(next);
    onChange(encode(next));
    setTrigger(null);
    setItems([]);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const pos = before.length + visible.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };


  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (trigger && items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + items.length) % items.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(items[active]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !trigger) {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
  };

  const popover = useMemo(() => {
    if (!trigger || items.length === 0) return null;
    const isEntity = trigger.type === "entity";
    return (
      <div className="absolute bottom-full mb-1 left-0 z-20 w-80 rounded-lg border bg-popover shadow-lg overflow-hidden">
        <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b flex items-center gap-1">
          {isEntity ? <Hash className="h-3 w-3" /> : <AtSign className="h-3 w-3" />}
          {isEntity ? "Lier un client, dossier, tâche ou pôle" : "Mentionner une personne"}
        </div>
        <div className="max-h-56 overflow-y-auto">
          {items.map((c, i) => {
            const Icon = KIND_ICON[c.kind];
            return (
              <button
                key={`${c.kind}-${c.id}`}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => insertMention(c)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left",
                  i === active ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{c.label}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {KIND_LABEL[c.kind]}
                    {c.sublabel ? ` · ${c.sublabel}` : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, items, active]);

  const defaultPh = enableEntities
    ? "Écrire… @ pour une personne, # pour un client/dossier/tâche/pôle"
    : "Écrire… @ pour mentionner une personne";

  // Aperçu des mentions présentes dans la saisie (badges lisibles + retrait 1 clic).
  const mentionChips = useMemo(() => {
    const segs = parseMentionSegments(value);
    return segs
      .filter((s) => s.kind !== "text")
      .map((s, idx) => {
        if (s.kind === "user") {
          return {
            key: `u-${idx}-${s.id}`,
            token: `@[${s.label}](user:${s.id})`,
            icon: User,
            label: s.label,
            prefix: "@",
            tone: "bg-primary/10 text-primary border-primary/30",
          };
        }
        const Icon = KIND_ICON[s.type];
        return {
          key: `e-${idx}-${s.type}-${s.id}`,
          token: `#[${s.label}](${s.type}:${s.id})`,
          icon: Icon,
          label: s.label,
          prefix: KIND_LABEL[s.type] + " :",
          tone:
            s.type === "client"
              ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30"
              : s.type === "dossier"
              ? "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30"
              : s.type === "task"
              ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30"
              : "bg-purple-500/10 text-purple-800 dark:text-purple-300 border-purple-500/30",
        };
      });
  }, [value]);

  const removeMention = (token: string) => {
    // Retire le token + un espace de séparation éventuel.
    const re = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s?", "g");
    onChange(value.replace(re, ""));
    requestAnimationFrame(() => ref.current?.focus());
  };

  return (
    <div className="relative">
      {popover}
      <Textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder ?? defaultPh}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
      {mentionChips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Mentions dans ce message">
          <span className="text-[11px] text-muted-foreground self-center">Vous mentionnez :</span>
          {mentionChips.map((c) => {
            const Icon = c.icon;
            return (
              <span
                key={c.key}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  c.tone,
                )}
              >
                <Icon className="h-3 w-3" />
                <span className="opacity-70">{c.prefix}</span>
                <span className="truncate max-w-[160px]">{c.label}</span>
                <button
                  type="button"
                  onClick={() => removeMention(c.token)}
                  className="ml-0.5 opacity-60 hover:opacity-100"
                  aria-label={`Retirer ${c.label}`}
                  title="Retirer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
