import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";

const QUICK_EMOJIS = ["👍", "✅", "👀", "❤️", "🎉", "🙏", "🚀", "🔥", "❓", "⚠️"];

type Reaction = { emoji: string; user_id: string };

export function MessageReactions({
  messageId,
  currentUserId,
  compact,
}: {
  messageId: string;
  currentUserId: string | null;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["internal-msg-reactions", messageId],
    queryFn: async () => {
      const { data } = await supabase
        .from("internal_message_reactions")
        .select("emoji, user_id")
        .eq("message_id", messageId);
      return (data ?? []) as Reaction[];
    },
  });

  const grouped = useMemo(() => {
    const m = new Map<string, { count: number; mine: boolean }>();
    for (const r of rows) {
      const cur = m.get(r.emoji) ?? { count: 0, mine: false };
      cur.count += 1;
      if (r.user_id === currentUserId) cur.mine = true;
      m.set(r.emoji, cur);
    }
    return Array.from(m.entries());
  }, [rows, currentUserId]);

  const toggle = useMutation({
    mutationFn: async (emoji: string) => {
      if (!currentUserId) throw new Error("Non connecté");
      const mine = rows.some((r) => r.emoji === emoji && r.user_id === currentUserId);
      if (mine) {
        await supabase
          .from("internal_message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", currentUserId)
          .eq("emoji", emoji);
      } else {
        await supabase
          .from("internal_message_reactions")
          .insert({ message_id: messageId, user_id: currentUserId, emoji });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["internal-msg-reactions", messageId] }),
  });

  return (
    <div className={cn("flex flex-wrap items-center gap-1", compact && "gap-0.5")}>
      {grouped.map(([emoji, info]) => (
        <button
          key={emoji}
          onClick={() => toggle.mutate(emoji)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
            info.mine
              ? "bg-primary/10 border-primary/40 text-primary"
              : "bg-background border-border hover:bg-muted",
          )}
        >
          <span className="text-sm leading-none">{emoji}</span>
          <span className="text-[10px] font-medium">{info.count}</span>
        </button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full opacity-60 hover:opacity-100">
            <SmilePlus className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-1" align="start">
          <div className="flex gap-0.5">
            {QUICK_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => toggle.mutate(e)}
                className="h-8 w-8 rounded hover:bg-muted text-lg leading-none"
              >
                {e}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
