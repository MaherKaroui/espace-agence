import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNowStrict } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

type Row = { user_id: string; last_seen_at: string | null; online: boolean };

export function usePresence(userIds: string[]) {
  const key = [...new Set(userIds)].filter(Boolean).sort();
  return useQuery({
    queryKey: ["presence", key],
    enabled: key.length > 0,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_presence", { _ids: key });
      if (error) throw error;
      const map = new Map<string, Row>();
      (data as Row[] | null)?.forEach((r) => map.set(r.user_id, r));
      return map;
    },
  });
}

export function PresenceDot({ online, className }: { online?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full ring-2 ring-background",
        online ? "bg-emerald-500" : "bg-muted-foreground/40",
        className,
      )}
      aria-label={online ? "En ligne" : "Hors ligne"}
    />
  );
}

export function PresenceLabel({ row }: { row?: Row | null }) {
  if (!row || !row.last_seen_at) {
    return <span className="text-xs text-muted-foreground">Jamais connecté</span>;
  }
  if (row.online) {
    return <span className="text-xs font-medium text-emerald-600">En ligne</span>;
  }
  const rel = formatDistanceToNowStrict(new Date(row.last_seen_at), { locale: fr, addSuffix: false });
  return <span className="text-xs text-muted-foreground">Vu il y a {rel}</span>;
}

export function PresenceAvatar({
  online,
  children,
  className,
}: {
  online?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {children}
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-background",
          online ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
      />
    </div>
  );
}
