import { Link } from "@tanstack/react-router";
import { parseMentionSegments, entityLink, type MentionEntityType } from "@/lib/mentions";
import { Building2, FolderOpen, ClipboardCheck, Users, AtSign } from "lucide-react";
import { cn } from "@/lib/utils";

const ENTITY_ICON: Record<MentionEntityType, any> = {
  client: Building2,
  dossier: FolderOpen,
  task: ClipboardCheck,
  pole: Users,
};

const ENTITY_TONE: Record<MentionEntityType, string> = {
  client: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  dossier: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  task: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  pole: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
};

export function RichMessageContent({
  content,
  currentUserId,
  className,
}: {
  content: string;
  currentUserId?: string | null;
  className?: string;
}) {
  const segs = parseMentionSegments(content);
  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      {segs.map((s, i) => {
        if (s.kind === "text") return <LinkifiedText key={i} text={s.value} />;
        if (s.kind === "user") {
          const me = s.id === currentUserId;
          return (
            <span
              key={i}
              className={cn(
                "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold mx-0.5 align-baseline ring-1 ring-current/30",
                "bg-current/15",
                me && "underline decoration-2 underline-offset-2",
              )}
            >
              <AtSign className="h-3 w-3" />
              {s.label}
            </span>
          );
        }
        const Icon = ENTITY_ICON[s.type];
        return (
          <Link
            key={i}
            to={entityLink(s.type, s.id)}
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium mx-0.5 align-baseline hover:underline",
              ENTITY_TONE[s.type],
            )}
          >
            <Icon className="h-3 w-3" />
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}
