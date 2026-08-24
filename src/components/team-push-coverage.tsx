import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTeamPushCoverage } from "@/lib/push.functions";
import { Card } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export function TeamPushCoverage() {
  const fetchCoverage = useServerFn(getTeamPushCoverage);
  const { data, isLoading, error } = useQuery({
    queryKey: ["team-push-coverage"],
    queryFn: () => fetchCoverage(),
  });

  const members = data?.members ?? [];
  const without = members.filter((m) => m.devices === 0).length;

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="font-semibold">Couverture des notifications navigateur</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Qui a activé les notifications sur au moins un appareil. {without > 0 && `${without} membre(s) sans aucun appareil.`}
        </p>
      </div>
      {isLoading && <div className="text-sm text-muted-foreground">Chargement…</div>}
      {error && <div className="text-sm text-destructive">Lecture impossible avec vos droits.</div>}
      {!isLoading && members.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 pr-3 font-medium">Membre</th>
                <th className="py-2 pr-3 font-medium">Appareils</th>
                <th className="py-2 pr-3 font-medium">Dernier envoi réussi</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${m.devices > 0 ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
                      {m.devices > 0 ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {m.devices}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {m.last_sent_at
                      ? formatDistanceToNow(new Date(m.last_sent_at), { addSuffix: true, locale: fr })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
