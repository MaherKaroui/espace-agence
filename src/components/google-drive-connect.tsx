import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HardDrive, Loader2 } from "lucide-react";
import {
  getDriveStatus,
  startDriveConnect,
  completeDriveConnection,
  disconnectDrive,
} from "@/lib/google-drive.functions";

function waitForOAuthCompletion(popup: Window) {
  return new Promise<string | null>((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        event.data?.connectorId !== "google_drive" ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      )
        return;
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        resolve(typeof event.data?.code === "string" ? event.data.code : null);
        return;
      }
      popup.close();
      reject(new Error("La connexion Google Drive a échoué."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("Fenêtre fermée avant la fin de la connexion."));
    }, 500);
  });
}

export function GoogleDriveConnect() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["drive-status"],
    queryFn: () => getDriveStatus(),
  });

  const connect = useMutation({
    mutationFn: async () => {
      const popup = window.open("", "izisuivis-drive-oauth", "width=600,height=720");
      if (!popup) throw new Error("Fenêtre bloquée. Autorisez les pop-ups puis réessayez.");
      let code: string | null;
      try {
        const { authorizationUrl } = await startDriveConnect();
        const completion = waitForOAuthCompletion(popup);
        popup.location.href = authorizationUrl;
        code = await completion;
      } catch (e) {
        popup.close();
        throw e;
      }
      if (code) await completeDriveConnection({ data: { code } });
    },
    onSuccess: () => {
      toast.success("Google Drive connecté");
      qc.invalidateQueries({ queryKey: ["drive-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur de connexion"),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectDrive(),
    onSuccess: () => {
      toast.success("Google Drive déconnecté");
      qc.invalidateQueries({ queryKey: ["drive-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <Card className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg">Google Drive</h2>
            <p className="text-sm text-muted-foreground">
              Connectez votre Drive pour classer automatiquement les documents des dossiers dans
              <span className="font-medium"> IZISuivis / Clients / Nom du client / OF / Type / Dossier</span>.
            </p>
          </div>
        </div>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : data?.connected ? (
          <Badge className="bg-success/15 text-success">Connecté</Badge>
        ) : (
          <Badge variant="outline">Non connecté</Badge>
        )}
      </div>

      {data?.connected && data.email && (
        <p className="text-sm text-muted-foreground">Compte : {data.email}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {data?.connected ? (
          <Button variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
            {disconnect.isPending ? "Déconnexion…" : "Déconnecter"}
          </Button>
        ) : (
          <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending ? "Connexion…" : "Connecter Google Drive"}
          </Button>
        )}
      </div>
    </Card>
  );
}
