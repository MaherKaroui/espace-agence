import { Card } from "@/components/ui/card";
import { CheckCircle2, Circle } from "lucide-react";
import { requiredDocsFor, docMatches, categorieLabel } from "@/lib/labels";

type Doc = { nom: string; detected_type?: string | null };

interface Props {
  categorie: string;
  documents: Doc[];
}

export function RequiredDocuments({ categorie, documents }: Props) {
  const requis = requiredDocsFor(categorie);
  if (requis.length === 0) return null;

  const items = requis.map((r) => ({
    ...r,
    provided: documents.some((d) => docMatches(d, r)),
  }));

  const done = items.filter((i) => i.provided).length;
  const missing = items.length - done;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-display text-xl">Documents requis</h2>
          <p className="text-sm text-muted-foreground">
            {categorieLabel(categorie)} — {done}/{items.length} fournis
            {missing > 0 && <span className="text-warning"> · {missing} manquant{missing > 1 ? "s" : ""}</span>}
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-center gap-3 text-sm">
            {it.provided ? (
              <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground shrink-0" />
            )}
            <span className={it.provided ? "text-foreground" : "text-muted-foreground"}>
              {it.label}
            </span>
            {!it.provided && (
              <span className="ml-auto text-xs uppercase tracking-wider text-warning">à fournir</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground mt-4">
        Astuce : nommez vos fichiers avec le mot-clé correspondant (ex. « kbis.pdf », « cni-recto.jpg »)
        pour que la reconnaissance soit automatique.
      </p>
    </Card>
  );
}
