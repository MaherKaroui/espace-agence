import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { summarizeInternalConversation } from "@/lib/internal-ai.functions";
import { toast } from "sonner";
import { RichMessageContent } from "@/components/rich-message-content";

export function ConversationSummaryButton({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const summarizeFn = useServerFn(summarizeInternalConversation);

  const run = useMutation({
    mutationFn: () => summarizeFn({ data: { conversationId, limit: 80 } }),
    onSuccess: (res: any) => setSummary(res.summary),
    onError: (e: any) => toast.error(e.message ?? "Résumé impossible"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v && !summary) run.mutate();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          Résumer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Résumé de la conversation
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto text-sm">
          {run.isPending && (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Génération du résumé…
            </div>
          )}
          {summary && !run.isPending && (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <MarkdownLite content={summary} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
            <RefreshCw className={run.isPending ? "h-4 w-4 mr-2 animate-spin" : "h-4 w-4 mr-2"} />
            Régénérer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Rendu markdown minimaliste (## titre + puces + gras) - évite d'ajouter une dépendance
function MarkdownLite({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = content.split("\n");
  let list: string[] = [];
  const flushList = () => {
    if (list.length > 0) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1 my-2">
          {list.map((it, i) => (
            <li key={i}>
              <InlineMd text={it} />
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushList();
      blocks.push(
        <h3 key={`h-${idx}`} className="font-semibold text-base mt-3 first:mt-0">
          {line.slice(3)}
        </h3>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      list.push(line.slice(2));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={`p-${idx}`} className="my-1.5">
          <InlineMd text={line} />
        </p>,
      );
    }
  });
  flushList();
  return <>{blocks}</>;
}

function InlineMd({ text }: { text: string }) {
  // gras **x** + italique *x* + code `x`
  const parts: (string | React.ReactNode)[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) parts.push(<code key={k++} className="px-1 rounded bg-muted">{t.slice(1, -1)}</code>);
    else parts.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
