import { Loader2, AlertCircle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function LoadingState({ label = "Chargement…", className }: { label?: string; className?: string }) {
  return (
    <Card className={cn("p-8 flex flex-col items-center justify-center gap-3 text-muted-foreground", className)}>
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </Card>
  );
}

export function ErrorState({
  title = "Une erreur est survenue",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card className={cn("p-8 flex flex-col items-center justify-center gap-3 text-center", className)}>
      <AlertCircle className="h-6 w-6 text-destructive" />
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </Card>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-10 flex flex-col items-center justify-center gap-3 text-center", className)}>
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="text-sm text-muted-foreground mt-1 max-w-md">{description}</p>}
      </div>
      {action}
    </Card>
  );
}
