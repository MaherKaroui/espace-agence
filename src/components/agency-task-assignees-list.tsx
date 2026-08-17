import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";

export function AgencyTaskAssigneesList({ taskId, mainAssignee }: { taskId: string; mainAssignee?: string | null }) {
  const { data: people = [] } = useQuery({
    queryKey: ["agency-task-assignees", taskId],
    queryFn: async () => {
      const { data } = await supabase.from("agency_task_assignees").select("user_id").eq("task_id", taskId);
      const ids = Array.from(new Set([...(data ?? []).map((r) => r.user_id), ...(mainAssignee ? [mainAssignee] : [])]));
      if (!ids.length) return [] as string[];
      const { data: profs } = await supabase.from("profiles").select("id, nom, prenom, email").in("id", ids);
      return (profs ?? []).map((p) => `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || p.id);
    },
  });

  if (people.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground flex items-center gap-1">
        <Users className="h-4 w-4" /> Assignés :
      </span>
      {people.map((p) => (
        <span key={p} className="px-2 py-0.5 rounded-full bg-muted text-xs font-medium">{p}</span>
      ))}
    </div>
  );
}
