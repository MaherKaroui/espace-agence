import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { Loader2 } from "lucide-react";

// Beta helper types — the SDK exposes these methods but they may not be typed yet
type OAuthDetails = {
  client?: { name?: string; redirect_uris?: string[] } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
  scope?: string | null;
  scopes?: string[] | null;
};
type OAuthResult = { data: OAuthDetails | null; error: { message: string } | null };
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};
const oauthApi = (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("authorization_id manquant");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi.getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="max-w-md p-6 text-center">
        <h1 className="font-display text-xl">Autorisation impossible</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {(error as Error)?.message ?? "Erreur inconnue"}
        </p>
      </Card>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState<null | "approve" | "deny">(null);
  const [error, setError] = useState<string | null>(null);

  const clientName = details?.client?.name ?? "une application";
  const scopes = details?.scopes ?? (details?.scope ? details.scope.split(/\s+/).filter(Boolean) : []);

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    const { data, error } = approve
      ? await oauthApi.approveAuthorization(authorization_id)
      : await oauthApi.denyAuthorization(authorization_id);
    if (error) { setBusy(null); setError(error.message); return; }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(null); setError("Aucune redirection retournée par le serveur d'autorisation."); return; }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-6">
          <Logo size={36} className="rounded-lg" />
          <span className="font-display text-lg">IZISuivis</span>
        </div>
        <h1 className="font-display text-2xl">Connecter {clientName} à votre compte</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {clientName} pourra utiliser les outils IZISuivis en votre nom pendant que vous êtes connecté·e.
        </p>

        <div className="mt-6 rounded-md border p-4 text-sm space-y-2">
          <div className="font-medium">Permissions demandées</div>
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>Partager votre profil de base et votre e-mail</li>
            {scopes.filter((s: string) => !["openid", "email", "profile"].includes(s)).map((s: string) => (
              <li key={s}>Permission supplémentaire : {s}</li>
            ))}
          </ul>
          <p className="pt-2 text-xs text-muted-foreground">
            Cela ne contourne pas les règles d'accès de la plateforme : vos données restent protégées par les politiques serveur.
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>
        )}

        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1" disabled={busy !== null} onClick={() => decide(false)}>
            {busy === "deny" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Refuser
          </Button>
          <Button className="flex-1" disabled={busy !== null} onClick={() => decide(true)}>
            {busy === "approve" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Autoriser
          </Button>
        </div>
      </Card>
    </main>
  );
}
