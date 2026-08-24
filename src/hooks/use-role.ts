import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export function useRole() {
  const { user, loading: authLoading } = useAuth();
  const q = useQuery({
    queryKey: ["role", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    placeholderData: (prev: any) => prev,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      const roles = (data ?? []).map((r) => r.role as string);
      const isAdmin = roles.includes("admin");
      const isDirection = roles.includes("direction");
      const isManager = roles.includes("manager");
      const isConsultant = roles.includes("consultant");
      const isClient = roles.includes("client");
      const isAuditeur = roles.includes("auditeur");
      const isCertificateur = roles.includes("certificateur");
      return {
        roles,
        isAdmin,
        isDirection,
        isManager,
        isConsultant,
        isClient,
        isAuditeur,
        isCertificateur,
        isStaff: isAdmin || isDirection || isManager || isConsultant,
        isDirectionOrAdmin: isAdmin || isDirection,
        isExternal: isAuditeur || isCertificateur,
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
    isAuditeur: q.data?.isAuditeur ?? false,
    isCertificateur: q.data?.isCertificateur ?? false,
    isStaff: q.data?.isStaff ?? false,
    isDirectionOrAdmin: q.data?.isDirectionOrAdmin ?? false,
    isExternal: q.data?.isExternal ?? false,
    loading: authLoading || (!!user && q.isLoading),
  };
}
