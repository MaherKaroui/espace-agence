import { Badge } from "@/components/ui/badge";
import { statutLabel, statutTone } from "@/lib/labels";
import { cn } from "@/lib/utils";

const toneClasses: Record<string, string> = {
  success: "bg-success/15 text-success border-success/20",
  info: "bg-info/15 text-info border-info/20",
  warning: "bg-warning/15 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/20",
  muted: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ statut }: { statut: string }) {
  const tone = statutTone(statut);
  return (
    <Badge variant="outline" className={cn("font-medium", toneClasses[tone])}>
      {statutLabel(statut)}
    </Badge>
  );
}
