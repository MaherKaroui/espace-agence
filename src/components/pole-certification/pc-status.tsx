import { cn } from "@/lib/utils";
import { PC_TONES, type PcTone } from "@/lib/pole-certification";

/** Badge de statut : couleur + icône + libellé (lisible sans distinguer les couleurs). */
export function PcStatusBadge({ tone, label, className }: { tone: PcTone; label?: string; className?: string }) {
  const t = PC_TONES[tone];
  const Icon = t.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap", t.badge, className)}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {label ?? t.label}
    </span>
  );
}

export function PcLegend() {
  const tones: PcTone[] = ["a_faire", "en_cours", "en_attente", "valide", "refuse", "recours", "a_recommencer", "retard", "bientot"];
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Code couleurs">
      {tones.map((t) => <PcStatusBadge key={t} tone={t} />)}
    </div>
  );
}
