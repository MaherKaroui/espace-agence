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

/** Légende discrète : pastille + libellé, affichée seulement là où la couleur porte l'information. */
export function PcLegend() {
  // Code couleurs du cahier des charges (§9).
  const items: [PcTone, string][] = [
    ["a_faire", "À faire"],
    ["en_cours", "En cours"],
    ["en_attente", "En attente de réponse"],
    ["valide", "Validé"],
    ["refuse", "Refusé ou en retard"],
    ["recours", "Recours"],
    ["a_recommencer", "À recommencer ou pièce qui expire"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Code couleurs">
      {items.map(([t, label]) => (
        <li key={t} className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", PC_TONES[t].dot)} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}
