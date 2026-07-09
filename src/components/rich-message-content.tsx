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
  inverse,
}: {
  content: string;
  currentUserId?: string | null;
  className?: string;
  inverse?: boolean;
}) {
  const segs = parseMentionSegments(content);
  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      {segs.map((s, i) => {
        if (s.kind === "text") return <LinkifiedText key={i} text={s.value} inverse={inverse} />;
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
              inverse ? "text-primary-foreground bg-primary-foreground/15" : ENTITY_TONE[s.type],
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

// Auto-linkify URLs, emails, and www.* inside plain text segments.
const URL_RE = /(\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?"'])|(\bwww\.[^\s<>()]+[^\s<>().,;:!?"'])|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function LinkifiedText({ text, inverse }: { text: string; inverse?: boolean }) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const raw = m[0];
    const isEmail = !!m[3];
    const href = isEmail ? `mailto:${raw}` : raw.startsWith("http") ? raw : `https://${raw}`;
    nodes.push(
      <a
        key={`${m.index}-${raw}`}
        href={href}
        target={isEmail ? undefined : "_blank"}
        rel={isEmail ? undefined : "noopener noreferrer"}
        className={cn(
          "underline underline-offset-2 hover:opacity-80 break-all",
          inverse ? "text-primary-foreground" : "text-primary",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {raw}
      </a>,
    );
    last = m.index + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes.map((n, i) => <span key={i}>{n}</span>)}</>;
}
