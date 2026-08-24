import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Source de vérité unique de « mes tâches » :
 * - tâches dont `assigned_to` est l'utilisateur,
 * - PLUS les tâches où il figure dans `agency_task_assignees`,
 * - dédoublonnées.
 */
export async function fetchMyTaskIds(userId: string): Promise<string[]> {
  const [own, extra] = await Promise.all([
    supabase.from("agency_tasks").select("id").eq("assigned_to", userId),
    supabase.from("agency_task_assignees").select("task_id").eq("user_id", userId),
  ]);
  const ids = new Set<string>();
  for (const r of own.data ?? []) ids.add(r.id as string);
  for (const r of extra.data ?? []) ids.add(r.task_id as string);
  return Array.from(ids);
}

export const myTaskIdsQueryKey = (userId?: string) => ["my-task-ids", userId] as const;

export function useMyTaskIds(enabled = true) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: myTaskIdsQueryKey(user?.id),
    enabled: !!user && enabled,
    queryFn: () => fetchMyTaskIds(user!.id),
  });
  return {
    ...query,
    idSet: new Set(query.data ?? []),
  };
}
