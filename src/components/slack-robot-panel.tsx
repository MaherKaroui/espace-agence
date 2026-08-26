import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle, Bot, Loader2, Pause, Play, PlugZap, RefreshCw, Users, FileDown, Clock,
} from "lucide-react";
import {
  robotTestConnexion, robotCanaux, robotDemarrer, robotStatut, robotEtat, robotAvancer,
  robotSyncMembres,
} from "@/lib/slack-robot.functions";

/** Débit réel imposé aux applications Slack récentes : 15 objets / minute. */
const OBJETS_PAR_MINUTE = 15;
const ESTIMATION_PAR_CANAL = 500;

function octets(n: number) {
  if (!n) return "0 o";
  const u = ["o", "ko", "Mo", "Go"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function duree(minutes: number) {
  if (minutes < 60) return `${Math.ceil(minutes)} min`;
  const h = minutes / 60;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} jours`;
}

export function SlackRobotPanel() {
  const qc = useQueryClient();
  const testFn = useServerFn(robotTestConnexion);
  const canauxFn = useServerFn(robotCanaux);
  const demarrerFn = useServerFn(robotDemarrer);
  const statutFn = useServerFn(robotStatut);
  const etatFn = useServerFn(robotEtat);
  const avancerFn = useServerFn(robotAvancer);
  const membresFn = useServerFn(robotSyncMembres);

  const [selection, setSelection] = useState<Record<string, boolean>>({});

  const connexion = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (d: any) => toast.success(`Connecté à ${d.team} en tant que ${d.bot}`),
    onError: (e: any) => toast.error(e?.message ?? "Connexion Slack impossible"),
  });

  const canaux = useQuery({
    queryKey: ["robot-canaux"],
    queryFn: () => canauxFn(),
    enabled: false,
    retry: false,
  });

  const etat = useQuery({
    queryKey: ["robot-etat"],
    queryFn: () => etatFn(),
    refetchInterval: 15_000,
  });

  const demarrer = useMutation({
    mutationFn: (payload: { channels: any[]; estimation_total: number }) =>
      demarrerFn({ data: payload }),
    onSuccess: () => {
      toast.success("Collecte démarrée. Elle avance en tâche de fond, chaque minute.");
      qc.invalidateQueries({ queryKey: ["robot-etat"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Démarrage impossible"),
  });

  const changerStatut = useMutation({
    mutationFn: (statut: "en_cours" | "pause" | "termine") => statutFn({ data: { statut } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["robot-etat"] }),
    onError: (e: any) => toast.error(e?.message ?? "Action impossible"),
  });

  const avancer = useMutation({
    mutationFn: () => avancerFn(),
    onSuccess: (r: any) => {
      toast.success(r?.skipped ? `Rien à faire : ${r.skipped}` : "Passage effectué");
      qc.invalidateQueries({ queryKey: ["robot-etat"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Passage impossible"),
  });

  const membres = useMutation({
    mutationFn: () => membresFn(),
    onSuccess: (r: any) => toast.success(`${r.membres} membres rapatriés`),
    onError: (e: any) => toast.error(e?.message ?? "Rapatriement des membres impossible"),
  });

  const choisis = useMemo(
    () => (canaux.data ?? []).filter((c: any) => selection[c.slack_channel_id]),
    [canaux.data, selection],
  );
  const estimation = choisis.length * ESTIMATION_PAR_CANAL;
  const minutes = estimation / OBJETS_PAR_MINUTE;

  const job = etat.data?.job ?? null;
  const fichiers = etat.data?.fichiers;
  const progression = job?.estimation_total
    ? Math.min(100, Math.round((job.messages / job.estimation_total) * 100))
    : 0;
  const resteMinutes = job?.estimation_total
    ? Math.max(0, (job.estimation_total - job.messages) / OBJETS_PAR_MINUTE)
    : 0;

  return (
    <div className="space-y-6">
      <Card className="border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" /> Ce que le robot peut, et ne peut pas, récupérer
        </div>
        <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
          <li>
            Portées à activer sur l'application Slack : <code>channels:read</code>,{" "}
            <code>channels:history</code>, <code>groups:read</code>, <code>groups:history</code>,{" "}
            <code>users:read</code>, <code>users:read.email</code>, <code>files:read</code>.
          </li>
          <li>
            Le robot doit être <strong>invité dans chaque canal privé</strong> pour pouvoir le lire.
          </li>
          <li>
            Les <strong>messages directs entre personnes ne sont pas accessibles</strong> avec un jeton
            de robot : ils exigeraient un jeton utilisateur avec <code>im:history</code>. Ils resteront
            hors de la collecte.
          </li>
          <li>
            Application créée récemment : Slack plafonne l'historique à environ{" "}
            <strong>15 messages par minute</strong>, soit ~900 par heure. La collecte est donc lente,
            continue, et reprend d'elle-même après interruption.
          </li>
          <li>Le jeton se saisit dans les secrets du projet (<code>SLACK_BOT_TOKEN</code>), jamais ici.</li>
        </ul>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => connexion.mutate()} disabled={connexion.isPending}>
            {connexion.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            Tester la connexion
          </Button>
          <Button variant="outline" onClick={() => canaux.refetch()} disabled={canaux.isFetching}>
            {canaux.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Lister les canaux
          </Button>
          <Button variant="outline" onClick={() => membres.mutate()} disabled={membres.isPending}>
            <Users className="h-4 w-4" /> Rapatrier les membres
          </Button>
        </div>
        {connexion.data ? (
          <p className="text-sm text-muted-foreground">
            Espace de travail : <strong>{(connexion.data as any).team}</strong> — robot connecté :{" "}
            <strong>{(connexion.data as any).bot}</strong>
          </p>
        ) : null}
      </Card>

      {canaux.data?.length ? (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium">Canaux à collecter</div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSelection(
                    Object.fromEntries(
                      (canaux.data ?? []).map((c: any) => [c.slack_channel_id, true]),
                    ),
                  )
                }
              >
                Tout sélectionner
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelection({})}>
                Tout désélectionner
              </Button>
            </div>
          </div>
          <label className="flex items-center gap-3 rounded border p-2 text-sm">
            <Checkbox
              checked={
                (canaux.data ?? []).length > 0 &&
                (canaux.data ?? []).every((c: any) => selection[c.slack_channel_id])
              }
              onCheckedChange={(v) =>
                setSelection(
                  v
                    ? Object.fromEntries(
                        (canaux.data ?? []).map((c: any) => [c.slack_channel_id, true]),
                      )
                    : {},
                )
              }
            />
            <span className="font-medium">
              Sélectionner tous les canaux ({(canaux.data ?? []).length})
            </span>
          </label>
          <div className="max-h-72 overflow-auto rounded border divide-y">
            {canaux.data.map((c: any) => (
              <label key={c.slack_channel_id} className="flex items-center gap-3 p-2 text-sm">
                <Checkbox
                  checked={!!selection[c.slack_channel_id]}
                  onCheckedChange={(v) =>
                    setSelection((s) => ({ ...s, [c.slack_channel_id]: !!v }))
                  }
                />
                <span className="font-medium">#{c.nom}</span>
                <Badge variant="outline">{c.type === "prive" ? "privé" : "public"}</Badge>
                {c.type === "prive" && !c.is_member ? (
                  <Badge variant="destructive">robot non invité</Badge>
                ) : null}
                <span className="ml-auto text-muted-foreground">{c.membres_count} membres</span>
              </label>
            ))}
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <Clock className="h-4 w-4" /> Estimation avant démarrage
            </div>
            <p className="text-muted-foreground">
              {choisis.length} canal(aux) sélectionné(s) — environ{" "}
              <strong>{estimation.toLocaleString("fr-FR")} messages</strong> estimés (base de{" "}
              {ESTIMATION_PAR_CANAL} par canal), soit <strong>{duree(minutes)}</strong> de collecte
              continue au débit autorisé de {OBJETS_PAR_MINUTE} messages par minute.
            </p>
          </div>

          <Button
            disabled={!choisis.length || demarrer.isPending}
            onClick={() =>
              demarrer.mutate({
                channels: choisis.map((c: any) => ({
                  slack_channel_id: c.slack_channel_id,
                  nom: c.nom,
                  type: c.type,
                  membres_count: c.membres_count ?? 0,
                })),
                estimation_total: estimation,
              })
            }
          >
            <Play className="h-4 w-4" /> Démarrer la collecte
          </Button>
        </Card>
      ) : null}

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-medium">
          <Bot className="h-4 w-4" /> Progression
          {job ? <Badge variant="outline">{job.statut.replace("_", " ")}</Badge> : null}
        </div>

        {!job ? (
          <p className="text-sm text-muted-foreground">Aucune collecte lancée pour le moment.</p>
        ) : (
          <>
            <Progress value={progression} />
            <div className="grid gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
              <div>
                Messages : <strong>{job.messages.toLocaleString("fr-FR")}</strong>
                {job.estimation_total ? ` / ~${job.estimation_total.toLocaleString("fr-FR")}` : ""}
              </div>
              <div>Canal en cours : <strong>{job.canal_courant ?? "—"}</strong></div>
              <div>Fils en attente : <strong>{job.threads_en_attente}</strong></div>
              <div>Temps restant estimé : <strong>{duree(resteMinutes)}</strong></div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <FileDown className="h-4 w-4" />
                Fichiers : <strong>{fichiers?.recuperes ?? 0}</strong> / {fichiers?.total ?? 0} —{" "}
                {octets(fichiers?.volume_recupere ?? 0)} sur {octets(fichiers?.volume_total ?? 0)}
              </div>
              {job.cooldown_until ? (
                <div className="sm:col-span-2">
                  Limite de débit Slack respectée : reprise à{" "}
                  {new Date(job.cooldown_until).toLocaleTimeString("fr-FR")}
                </div>
              ) : null}
              {job.derniere_erreur ? (
                <div className="sm:col-span-2 text-amber-600">
                  Dernière erreur : {job.derniere_erreur}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {job.statut === "en_cours" ? (
                <Button variant="outline" onClick={() => changerStatut.mutate("pause")}>
                  <Pause className="h-4 w-4" /> Mettre en pause
                </Button>
              ) : (
                <Button onClick={() => changerStatut.mutate("en_cours")}>
                  <Play className="h-4 w-4" /> Reprendre
                </Button>
              )}
              <Button variant="outline" onClick={() => avancer.mutate()} disabled={avancer.isPending}>
                {avancer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Avancer maintenant
              </Button>
              <Button variant="ghost" onClick={() => changerStatut.mutate("termine")}>
                Arrêter
              </Button>
            </div>
          </>
        )}

        <div className="rounded-md border p-3 text-sm">
          <div className="font-medium mb-1">Canaux</div>
          <div className="space-y-1 max-h-56 overflow-auto">
            {(etat.data?.canaux ?? []).map((c: any) => (
              <div key={c.id} className="flex items-center gap-2">
                <span>#{c.nom}</span>
                <span className="text-muted-foreground">{c.collecte_messages} messages</span>
                {c.collecte_terminee ? <Badge variant="outline">terminé</Badge> : null}
                {c.collecte_erreur ? (
                  <span className="text-amber-600 truncate">{c.collecte_erreur}</span>
                ) : null}
              </div>
            ))}
            {!(etat.data?.canaux ?? []).length ? (
              <p className="text-muted-foreground">Aucun canal sélectionné.</p>
            ) : null}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Les accès détectés dans les messages collectés se valident dans l'onglet « Accès détectés » :
          les secrets y sont chiffrés et restent hors de portée de l'assistant IA.
        </p>
      </Card>
    </div>
  );
}
