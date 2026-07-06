import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, MessageSquare } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { openContextConversation } from "@/lib/internal-messages.functions";

type ContextType = "pole" | "client" | "dossier" | "task";

interface Props extends Omit<ButtonProps, "onClick" | "type"> {
  contextType: ContextType;
  entityId: string;
  label?: string;
  hideIcon?: boolean;
}


const DEFAULT_LABEL: Record<ContextType, string> = {
  pole: "Discuter en interne (pôle)",
  client: "Discuter en interne sur ce client",
  dossier: "Discuter en interne sur ce dossier",
  task: "Discussion interne de la tâche",
};

export function OpenInternalConversationButton({
  type,
  entityId,
  label,
  hideIcon,
  variant = "outline",
  size,
  className,
  disabled,
  children,
}: Props) {
  const nav = useNavigate();
  const openFn = useServerFn(openContextConversation);

  const m = useMutation({
    mutationFn: () => openFn({ data: { type, entityId } }),
    onSuccess: ({ id }) => nav({ to: "/admin/internal-messages/$id", params: { id } }),
    onError: (e: any) => toast.error(e.message ?? "Impossible d'ouvrir la conversation"),
  });

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={disabled || m.isPending}
      onClick={() => m.mutate()}
    >
      {m.isPending ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : hideIcon ? null : (
        <MessageSquare className="h-4 w-4 mr-2" />
      )}
      {children ?? label ?? DEFAULT_LABEL[type]}
    </Button>
  );
}
