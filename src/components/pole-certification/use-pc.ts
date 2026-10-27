import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { fetchPcAll, fetchPcStaff, fetchPcProfiles, type PcProfile } from "@/lib/pole-certification";

export const PC_ALL_KEY = ["pc-all"] as const;

/** Tous les dossiers visibles (RLS) avec étapes, pièces et membres. */
export function usePcAll() {
  const { user } = useAuth();
  return useQuery({ queryKey: PC_ALL_KEY, enabled: !!user, queryFn: fetchPcAll });
}

export function usePcStaff() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["pc-staff"], enabled: !!user, staleTime: 5 * 60_000, queryFn: fetchPcStaff });
}

/** Profils staff + profils cités (responsables, auteurs) indexés par id. */
export function usePcProfiles(extraIds: string[] = []) {
  const staff = usePcStaff();
  const missing = extraIds.filter((id) => id && !(staff.data ?? []).some((p) => p.id === id));
  const extra = useQuery({
    queryKey: ["pc-profiles", [...new Set(missing)].sort()],
    enabled: staff.isSuccess && missing.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => fetchPcProfiles(missing),
  });
  return useMemo(() => {
    const m = new Map<string, PcProfile>();
    for (const p of [...(staff.data ?? []), ...(extra.data ?? [])]) m.set(p.id, p);
    return m;
  }, [staff.data, extra.data]);
}
