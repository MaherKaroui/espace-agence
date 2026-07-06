import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { searchMentionCandidates } from "@/lib/mention-search.functions";
import { Textarea } from "@/components/ui/textarea";
import { AtSign, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "user";

type Candidate = { id: string; label: string; sublabel?: string };

export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  conversationId,
  placeholder,
  rows = 2,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  conversationId?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const search = useServerFn(searchMentionCandidates);
  const [trigger, setTrigger] = useState<null | {
    kind: Kind | "pick-entity";
    start: number; // index of the trigger char
    query: string;
  }>(null);
  const [items, setItems] = useState<Candidate[]>([]);
  const [active, setActive] = useState(0);

  // Détecter @ ou # devant le curseur
  const detectTrigger = (text: string, caret: number) => {
    // Cherche le dernier @ ou # non séparé par espace/newline avant caret
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === " " || ch === "\n" || ch === "\t") return null;
      if (ch === "@") {
        return { kind: "user" as Kind, start: i, query: text.slice(i + 1, caret) };
      }
      if (ch === "#") {
        return { kind: "pick-entity" as const, start: i, query: text.slice(i + 1, caret) };
      }
    }
    return null;
  };

  const handleChange = (v: string) => {
    onChange(v);
    const el = ref.current;
    const caret = el?.selectionStart ?? v.length;
    const t = detectTrigger(v, caret);
    setTrigger(t);
    setActive(0);
  };

  // Charger les candidats
  useEffect(() => {
    if (!trigger) {
      setItems([]);
      return;
    }
    if (trigger.kind === "pick-entity") {
      // Étape 1 : choix du type d'entité (client / dossier / …)
      setItems([]);
      return;
    }
    let cancelled = false;
    search({
      data: { kind: trigger.kind, query: trigger.query, conversationId },
    })
      .then((rows: any) => {
        if (!cancelled) setItems(rows as Candidate[]);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [trigger?.kind, trigger?.query, conversationId, search]);

  const insertMention = (kind: Exclude<Kind, "user"> | "user", c: Candidate) => {
    if (!trigger) return;
    const before = value.slice(0, trigger.start);
    const after = value.slice((ref.current?.selectionStart ?? value.length));
    const token =
      kind === "user"
        ? `@[${c.label}](user:${c.id}) `
        : `#[${c.label}](${kind}:${c.id}) `;
    const next = `${before}${token}${after}`;
    onChange(next);
    setTrigger(null);
    setItems([]);
    // Repositionner le curseur en fin de token
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const pos = before.length + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const pickEntityKind = (k: Exclude<Kind, "user">) => {
    if (!trigger) return;
    setTrigger({ kind: k, start: trigger.start, query: trigger.query });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (trigger && trigger.kind === "pick-entity") {
      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        return;
      }
    }
    if (trigger && trigger.kind !== "pick-entity" && items.length > 0) {
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
        insertMention(trigger.kind as any, items[active]);
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
    if (!trigger) return null;
    if (trigger.kind === "pick-entity") {
      return (
        <div className="absolute bottom-full mb-1 left-0 z-20 w-64 rounded-lg border bg-popover shadow-lg overflow-hidden">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b">
            Mentionner…
          </div>
          {ENTITY_KINDS.map((k) => {
            const Icon = k.icon;
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => pickEntityKind(k.key)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted text-left"
              >
                <Icon className={cn("h-4 w-4", k.color)} />
                <span>{k.label}</span>
              </button>
            );
          })}
        </div>
      );
    }
    if (items.length === 0) return null;
    const Icon =
      trigger.kind === "user"
        ? User
        : ENTITY_KINDS.find((k) => k.key === trigger.kind)?.icon ?? Hash;
    return (
      <div className="absolute bottom-full mb-1 left-0 z-20 w-80 rounded-lg border bg-popover shadow-lg overflow-hidden">
        <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b flex items-center gap-1">
          {trigger.kind === "user" ? (
            <AtSign className="h-3 w-3" />
          ) : (
            <Hash className="h-3 w-3" />
          )}
          {trigger.kind === "user" ? "Personne" : trigger.kind}
        </div>
        <div className="max-h-56 overflow-y-auto">
          {items.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => insertMention(trigger.kind as any, c)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left",
                i === active ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{c.label}</div>
                {c.sublabel && (
                  <div className="text-[11px] text-muted-foreground truncate">{c.sublabel}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, items, active]);

  return (
    <div className="relative">
      {popover}
      <Textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder ?? "Écrire… @ pour mentionner, # pour lier"}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
    </div>
  );
}
