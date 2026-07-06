import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { searchMentionCandidates } from "@/lib/mention-search.functions";
import { Textarea } from "@/components/ui/textarea";
import { AtSign, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Candidate = { id: string; label: string; sublabel?: string };

/**
 * Zone de saisie avec autocomplete `@` sur les personnes uniquement.
 * Volontairement plus de `#` pour lier des clients / dossiers / tâches — la
 * messagerie interne concerne seulement l'équipe.
 */
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
  const [trigger, setTrigger] = useState<null | { start: number; query: string }>(null);
  const [items, setItems] = useState<Candidate[]>([]);
  const [active, setActive] = useState(0);

  const detectTrigger = (text: string, caret: number) => {
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === " " || ch === "\n" || ch === "\t") return null;
      if (ch === "@") return { start: i, query: text.slice(i + 1, caret) };
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
    search({ data: { kind: "user", query: trigger.query, conversationId } })
      .then((rows: any) => {
        if (!cancelled) setItems(rows as Candidate[]);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [trigger?.query, conversationId, search]);

  const insertMention = (c: Candidate) => {
    if (!trigger) return;
    const before = value.slice(0, trigger.start);
    const after = value.slice(ref.current?.selectionStart ?? value.length);
    const token = `@[${c.label}](user:${c.id}) `;
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
    return (
      <div className="absolute bottom-full mb-1 left-0 z-20 w-80 rounded-lg border bg-popover shadow-lg overflow-hidden">
        <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b flex items-center gap-1">
          <AtSign className="h-3 w-3" /> Mentionner une personne
        </div>
        <div className="max-h-56 overflow-y-auto">
          {items.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => insertMention(c)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left",
                i === active ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
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
        placeholder={placeholder ?? "Écrire… @ pour mentionner une personne"}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
    </div>
  );
}
