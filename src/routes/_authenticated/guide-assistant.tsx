import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bot,
  ShieldCheck,
  Ban,
  MessageSquareQuote,
  FileCheck2,
  ArrowLeft,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/use-role";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/guide-assistant")({
  head: () => ({
    meta: [
      { title: "Guide de l'assistant IA — IZISuivis" },
      {
        name: "description",
        content:
          "Comment utiliser l'assistant IZISuivis : créer une demande en trois phrases, suivre un dossier, connaître les pièces à déposer.",
      },
      { property: "og:title", content: "Guide de l'assistant IA — IZISuivis" },
      {
        property: "og:description",
        content: "Ce que l'assistant IZISuivis sait faire, et ce qu'il ne fera jamais.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GuideAssistantPage,
});

/* ------------------------------------------------------------ éléments déco */

function Hand({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "font-hand text-[color:var(--guide-ink)] text-xl leading-snug -rotate-2 inline-block",
        className,
      )}
    >
      {children}
    </span>
  );
}

function ArrowCurve({ className, flip }: { className?: string; flip?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 120 60"
      className={cn("h-10 w-24 text-[color:var(--guide-ink)]", flip && "-scale-x-100", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12c22 26 52 36 96 34" />
      <path d="M84 38c8 3 13 5 16 8" />
      <path d="M92 30c5 6 7 11 8 16" />
    </svg>
  );
}

function Bubble({
  from,
  children,
}: {
  from: "user" | "assistant";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-sm",
        from === "user"
          ? "ml-auto rounded-br-sm bg-primary text-primary-foreground"
          : "mr-auto rounded-bl-sm bg-card text-card-foreground border",
      )}
    >
      {children}
    </div>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-hand text-xl">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm">
      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
      <span>{children}</span>
    </li>
  );
}

/* ------------------------------------------------------------------- page */

function GuideAssistantPage() {
  const { isStaff, isExternal, loading } = useRole();
  const equipe = isStaff || isExternal;

  const phrases = equipe
    ? [
        ["« Fais une demande de Qualiopi pour GHM Formation »", "prépare le dossier et la liste des pièces, à confirmer"],
        ["« Qu'est-ce qui manque sur le dossier BELLIS ? »", "liste les pièces demandées et non déposées"],
        ["« Mes tâches en retard »", "vos tâches dont l'échéance est dépassée"],
        ["« Crée une tâche de relance AFNOR pour jeudi »", "prépare la tâche avec son échéance, à confirmer"],
        ["« Qu'est-ce qui risque de déraper cette semaine ? »", "dossiers stagnants et tâches en retard de votre périmètre"],
      ]
    : [
        ["« Je veux faire une demande de NDA »", "prépare le dossier et la liste des pièces, à confirmer"],
        ["« Où en est ma demande ? »", "statut, ancienneté et prochaine action"],
        ["« Qu'est-ce qu'il vous manque ? »", "les pièces qu'il vous reste à déposer"],
        ["« Pourquoi vous me demandez le règlement intérieur ? »", "l'indicateur Qualiopi concerné, cité depuis le référentiel"],
      ];

  return (
    <main className="guide-paper -mx-4 px-4 py-6 lg:-mx-6 lg:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-12">
        <header className="space-y-3">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/dashboard">
              <ArrowLeft className="mr-1 h-4 w-4" /> Retour
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <Bot className="h-7 w-7 text-primary" aria-hidden="true" />
            <h1 className="font-display text-3xl">Le guide de l'assistant</h1>
          </div>
          <p className="text-muted-foreground">
            {loading
              ? "…"
              : equipe
                ? "Ce qu'il sait faire pour vous, côté agence — et ce qu'il ne fera jamais."
                : "Ce qu'il sait faire pour vous — et ce qu'il ne fera jamais."}
          </p>
        </header>

        {/* 1 */}
        <Section n={1} title="D'abord, où il se cache">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Card className="relative h-40 overflow-hidden p-4">
              <div className="text-xs text-muted-foreground">n'importe quelle page</div>
              <div className="absolute right-4 bottom-4 flex h-14 w-14 items-center justify-center rounded-full bg-sidebar text-sidebar-foreground shadow-lg ring-1 ring-primary/30">
                <Bot className="h-6 w-6" aria-hidden="true" />
              </div>
            </Card>
            <div className="flex items-center gap-2 sm:flex-col sm:items-start">
              <ArrowCurve flip className="rotate-[190deg] sm:rotate-180" />
              <Hand>toujours là,<br />en bas à droite</Hand>
            </div>
          </div>
        </Section>

        {/* 2 */}
        <Section n={2} title="Faire une demande — sans remplir un seul formulaire">
          <div className="grid gap-4 lg:grid-cols-[1fr_180px] lg:items-center">
            <Card className="space-y-3 p-4">
              <Bubble from="user">Je veux faire une demande de NDA</Bubble>
              <Bubble from="assistant">Bien sûr. Pour quel organisme de formation ?</Bubble>
              <Bubble from="user">Pour SUP ACADEMY FRANCE</Bubble>
              <Bubble from="assistant">
                Voici ce que je vais créer. Confirmez et je m'en occupe.
              </Bubble>
              <div className="mr-auto w-full max-w-[95%] rounded-xl border border-primary/40 bg-card p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <FileCheck2 className="h-4 w-4 text-primary" aria-hidden="true" /> Confirmation requise
                </div>
                <div>
                  <span className="text-muted-foreground">Catégorie : </span>Demande de NDA
                </div>
                <div>
                  <span className="text-muted-foreground">Organisme : </span>SUP ACADEMY FRANCE
                </div>
                <div className="text-muted-foreground">Statut initial : En attente</div>
                <ul className="mt-2 space-y-1">
                  {["Extrait Kbis", "Pièce d'identité du dirigeant", "Programme de formation", "CV du formateur"].map(
                    (p) => (
                      <li key={p} className="rounded border px-2 py-1">
                        {p}
                      </li>
                    ),
                  )}
                </ul>
              </div>
              <Bubble from="user">C'est bon</Bubble>
              <Bubble from="assistant">
                {"Dossier créé. Il vous reste à déposer :\n• Extrait Kbis\n• Pièce d'identité du dirigeant\n• Programme de formation\n• CV du formateur"}
              </Bubble>
            </Card>
            <div className="flex items-center gap-2 lg:flex-col lg:items-start">
              <ArrowCurve className="rotate-180 lg:rotate-[200deg]" />
              <Hand className="rotate-2">3 phrases,<br />et le dossier existe</Hand>
            </div>
          </div>

          <Card className="border-gold/50 bg-gold/10 p-4 text-sm">
            <strong>La liste des pièces n'est pas inventée.</strong> Elle est enregistrée dans
            l'application et modifiable par l'agence. Une liste improvisée changerait à chaque
            conversation — et serait fausse le jour d'un audit.
          </Card>
        </Section>

        {/* 3 */}
        <Section n={3} title="Tout ce que vous pouvez lui demander">
          <div className="grid gap-4 md:grid-cols-2">
            {equipe && (
              <Card className="space-y-3 p-4">
                <Badge variant="secondary">Côté équipe</Badge>
                <ul className="space-y-2">
                  <Bullet>
                    Créer un dossier dans toutes les catégories : Qualiopi, BPF, NDA, CFA, VAE,
                    EDOF, juridique.
                  </Bullet>
                  <Bullet>Demander une pièce complémentaire sur un dossier.</Bullet>
                  <Bullet>Connaître l'état d'un dossier et ce qui manque.</Bullet>
                  <Bullet>Créer une tâche avec échéance, changer un statut, assigner, commenter.</Bullet>
                  <Bullet>Lister ses tâches, celles de son pôle, ou celles en retard.</Bullet>
                  <Bullet>
                    Interroger le portefeuille : « qu'est-ce qui risque de déraper cette semaine ? »
                  </Bullet>
                  <Bullet>Rédiger une relance — en brouillon, jamais envoyée.</Bullet>
                </ul>
              </Card>
            )}
            <Card className="space-y-3 p-4">
              <Badge variant="secondary">Côté client</Badge>
              <ul className="space-y-2">
                <Bullet>Déposer une demande soi-même, sans écrire à l'agence.</Bullet>
                <Bullet>Savoir où en est son dossier, à toute heure.</Bullet>
                <Bullet>Savoir précisément ce qui manque.</Bullet>
                <Bullet>
                  Comprendre pourquoi un document est demandé, avec l'indicateur Qualiopi cité.
                </Bullet>
                <Bullet>Être guidé pour déposer une pièce.</Bullet>
                <Bullet>Être transmis à un humain dès que la question sort du périmètre.</Bullet>
              </ul>
            </Card>
          </div>
        </Section>

        {/* 4 */}
        <Section n={4} title="Comment ça se passe, à chaque fois">
          <div className="grid gap-4 lg:grid-cols-[1fr_180px] lg:items-center">
            <ol className="space-y-3">
              {[
                "Vous dites ce que vous voulez, avec vos mots.",
                "S'il lui manque une information, il pose une question — une seule à la fois.",
                "Il montre exactement ce qu'il va faire. Rien n'est encore écrit.",
                "Vous confirmez ou vous annulez. L'action est tracée dans le journal d'audit.",
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="font-hand text-3xl leading-none text-[color:var(--guide-ink)]">
                    {i + 1}
                  </span>
                  <span className="pt-1 text-sm">{t}</span>
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-2 lg:flex-col lg:items-start">
              <ArrowCurve className="rotate-180 lg:rotate-[200deg]" />
              <Hand>jamais rien<br />dans ton dos</Hand>
            </div>
          </div>
        </Section>

        {/* 5 */}
        <Section n={5} title="Il ne voit que ce qui vous concerne">
          <Card className="space-y-2 border-success/50 bg-success/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" /> Cloisonnement
            </div>
            <p>
              Une personne du pôle EDOF n'obtient que de l'EDOF — même en insistant, même en
              reformulant. Un client n'obtient jamais rien sur un autre client.
            </p>
            <p>
              Cette séparation est appliquée par la base de données elle-même, avant que
              l'assistant ne voie la moindre donnée. Ce n'est pas une consigne qu'on pourrait
              contourner en changeant la formulation.
            </p>
          </Card>
        </Section>

        {/* 6 */}
        <Section n={6} title="Ce qu'il ne fera pas">
          <Card className="space-y-2 border-destructive/50 bg-destructive/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Ban className="h-4 w-4 text-destructive" aria-hidden="true" /> Limites assumées
            </div>
            <p>Il n'envoie jamais un message tout seul : il prépare un brouillon, vous l'envoyez.</p>
            <p>
              Il n'invente pas. Si l'information n'est pas dans les données, il le dit et transmet.
              Sur du Qualiopi ou du BPF, une réponse inventée mais crédible ne se repère que le jour
              de l'audit.
            </p>
            <p>
              Il ne donne pas de conseil réglementaire ferme : il cite le texte et laisse trancher.
            </p>
          </Card>
        </Section>

        {/* 7 */}
        <Section n={7} title="Pour bien lui parler">
          <Card className="divide-y p-0">
            {phrases.map(([p, effet]) => (
              <div key={p} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-baseline sm:gap-4">
                <div className="flex items-start gap-2 sm:w-1/2">
                  <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="text-sm font-medium">{p}</span>
                </div>
                <span className="text-sm text-muted-foreground sm:w-1/2">{effet}</span>
              </div>
            ))}
          </Card>
          <Hand className="block">recopiez-les telles quelles, ça marche</Hand>
        </Section>
      </div>
    </main>
  );
}
