import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export function useRole() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["role", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      const roles = (data ?? []).map((r) => r.role);
      return { roles, isAdmin: roles.includes("admin"), isClient: roles.includes("client") };
    },
  });
  return {
    roles: q.data?.roles ?? [],
    isAdmin: q.data?.isAdmin ?? false,
    isClient: q.data?.isClient ?? false,
    loading: q.isLoading,
  };
}
