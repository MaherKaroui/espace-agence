import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HardDrive } from "lucide-react";
import { getDriveStatus, syncDossierToDrive } from "@/lib/google-drive.functions";

export function DossierDriveSync({ dossierId }: { dossierId: string }) {
  const { data: status } = useQuery({
    queryKey: ["drive-status"],
    queryFn: () => getDriveStatus(),
  });

  const sync = useMutation({
    mutationFn: () => syncDossierToDrive({ data: { dossierId } }),
    onSuccess: (r) => {
      if (r.uploaded === 0 && r.skipped === 0) toast.info("Aucun document à classer");
      else toast.success(`${r.uploaded} document(s) classé(s), ${r.skipped} déjà présent(s)`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur Google Drive"),
  });

  if (!status?.connected) return null;

  return (
    <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
      <HardDrive className="h-4 w-4 mr-2" />
      {sync.isPending ? "Classement…" : "Classer dans mon Drive"}
    </Button>
  );
}
