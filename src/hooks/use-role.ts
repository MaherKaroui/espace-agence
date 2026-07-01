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
      const isAdmin = roles.includes("admin");
      const isDirection = roles.includes("direction");
      const isManager = roles.includes("manager");
      const isConsultant = roles.includes("consultant");
      const isClient = roles.includes("client");
      return {
        roles,
        isAdmin,
        isDirection,
        isManager,
        isConsultant,
        isClient,
        isStaff: isAdmin || isDirection || isManager || isConsultant,
        isDirectionOrAdmin: isAdmin || isDirection,
      };
    },
  });
  return {
    roles: q.data?.roles ?? [],
    isAdmin: q.data?.isAdmin ?? false,
    isDirection: q.data?.isDirection ?? false,
    isManager: q.data?.isManager ?? false,
    isConsultant: q.data?.isConsultant ?? false,
    isClient: q.data?.isClient ?? false,
    isStaff: q.data?.isStaff ?? false,
    isDirectionOrAdmin: q.data?.isDirectionOrAdmin ?? false,
    loading: q.isLoading,
  };
}
