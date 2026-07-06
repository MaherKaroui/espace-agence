import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { searchMentionCandidates } from "@/lib/mention-search.functions";
import { Textarea } from "@/components/ui/textarea";
import { AtSign, Hash, User, Building2, FolderOpen, ClipboardCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

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
  placeholder,
  rows = 2,
  disabled,
  enableEntities = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  conversationId?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  enableEntities?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const search = useServerFn(searchMentionCandidates);
  const [trigger, setTrigger] = useState<null | { start: number; query: string; type: "user" | "entity" }>(null);
  const [items, setItems] = useState<Candidate[]>([]);
  const [active, setActive] = useState(0);

  const detectTrigger = (text: string, caret: number) => {
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === " " || ch === "\n" || ch === "\t") return null;
      if (ch === "@") return { start: i, query: text.slice(i + 1, caret), type: "user" as const };
      if (ch === "#" && enableEntities)
        return { start: i, query: text.slice(i + 1, caret), type: "entity" as const };
    }
    return null;
  };

  const handleChange = (v: string) => {
    onChange(v);
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
        search({ data: { kind: k, query: trigger.query, conversationId } })
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
  }, [trigger?.query, trigger?.type, conversationId, search]);

  const insertMention = (c: Candidate) => {
    if (!trigger) return;
    const before = value.slice(0, trigger.start);
    const after = value.slice(ref.current?.selectionStart ?? value.length);
    const token =
      c.kind === "user"
        ? `@[${c.label}](user:${c.id}) `
        : `#[${c.label}](${c.kind}:${c.id}) `;
    const next = `${before}${token}${after}`;
    onChange(next);
    setTrigger(null);
    setItems([]);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const pos = before.length + token.length;
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
    </div>
  );
}
