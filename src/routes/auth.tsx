import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Logo } from "@/components/logo";
import { sendTransactionalEmail } from "@/lib/email/send";
import { APP_URL } from "@/lib/app-url";


export const Route = createFileRoute("/auth")({
  // SSR activé : le rendu ne dépend d'aucune donnée navigateur (la session
  // Supabase n'est lue que dans un useEffect). Avec ssr:false le serveur
  // n'envoyait qu'un fallback, ce qui provoquait un mismatch d'hydratation.
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" ? { next: s.next } : {},
  head: () => ({
    meta: [
      { title: "Connexion — IZISuivis" },
      { name: "description", content: "Connectez-vous ou créez votre compte pour accéder à votre espace client." },
    ],
  }),
  component: AuthPage,
});

// Validate `next` as a same-origin relative path before using it as a redirect.
function safeNext(next: string | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}


const signupSchema = z.object({
  prenom: z.string().trim().min(1, "Prénom requis").max(60),
  nom: z.string().trim().min(1, "Nom requis").max(60),
  email: z.string().trim().email("Adresse e-mail invalide").max(255),
  password: z.string().min(8, "8 caractères minimum").max(72),
});
const loginSchema = z.object({
  email: z.string().trim().email("E-mail invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const nextPath = safeNext(next);
  
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [showSignupPwd, setShowSignupPwd] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        if (nextPath) window.location.replace(nextPath);
        else navigate({ to: "/dashboard" });
      }
    });
  }, [navigate, nextPath]);


  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Case obligatoire d'acceptation CGU / Politique de confidentialité (RGPD)
    if (!fd.get("accept_legal")) {
      toast.error("Vous devez accepter les CGU et la Politique de confidentialité.");
      return;
    }
    const parsed = signupSchema.safeParse(Object.fromEntries(fd));
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setLoading(true);
    const { email, password, nom, prenom } = parsed.data;
    const { data: sud, error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${APP_URL}${nextPath ?? "/"}`,
        data: { nom, prenom },
      },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Compte créé. Vérifiez votre e-mail pour l'activer.");
    // Notifications (fire-and-forget) — nécessitent une session (auto-confirm activé
    // ou email de confirmation désactivé). Sinon les emails sont envoyés à la 1re connexion.
    const clientName = `${prenom} ${nom}`.trim();
    const appUrl = APP_URL;
    if (sud.session) {
      sendTransactionalEmail({
        templateName: "admin-new-client",
        idempotencyKey: `admin-new-client-${sud.user?.id}`,
        templateData: { clientName, clientEmail: email, appUrl },
      });
      sendTransactionalEmail({
        templateName: "welcome-client",
        recipientEmail: email,
        idempotencyKey: `welcome-client-${sud.user?.id}`,
        templateData: { prenom, appUrl },
      });
    }
    setTab("login");

  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = loginSchema.safeParse(Object.fromEntries(fd));
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    if (nextPath) window.location.replace(nextPath);
    else navigate({ to: "/dashboard" });
  };

  const handleGoogle = async () => {
    setLoading(true);
    const redirectUri = nextPath
      ? `${window.location.origin}/auth?next=${encodeURIComponent(nextPath)}`
      : window.location.origin;
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: redirectUri });
    if (res.error) { setLoading(false); toast.error("Connexion Google impossible"); return; }
    if (res.redirected) return;
    if (nextPath) window.location.replace(nextPath);
    else navigate({ to: "/dashboard" });
  };

  const handleApple = async () => {
    setLoading(true);
    const redirectUri = nextPath
      ? `${window.location.origin}/auth?next=${encodeURIComponent(nextPath)}`
      : window.location.origin;
    const res = await lovable.auth.signInWithOAuth("apple", { redirect_uri: redirectUri });
    if (res.error) { setLoading(false); toast.error("Connexion Apple impossible"); return; }
    if (res.redirected) return;
    if (nextPath) window.location.replace(nextPath);
    else navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex bg-gradient-hero text-white p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <Logo size={40} className="rounded-lg" />
          <span className="font-display text-xl">IZISuivis</span>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-4xl leading-tight">Votre plateforme dédiée aux organismes de formation.</h1>
          <p className="mt-4 text-white/70">Qualiopi, BPF, NDA, CFA, VAE, EDOF — centralisez vos dossiers, échangez avec votre agence et suivez chaque avancement en temps réel.</p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            <li>• Espace sécurisé et confidentiel</li>
            <li>• Messagerie interne (fini WhatsApp)</li>
            <li>• Suivi d'avancement en temps réel</li>
            <li>• Documents et pièces justificatives centralisés</li>
          </ul>
        </div>
        <p className="text-xs text-white/40">© {new Date().getFullYear()} — IZISuivis</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <Card className="w-full max-w-md p-8 border-border shadow-sm">
          <div className="mb-6 lg:hidden flex items-center gap-2">
            <Logo size={36} className="rounded-lg" />
            <span className="font-display text-lg">IZISuivis</span>
          </div>
          <h2 className="font-display text-2xl">Bienvenue</h2>
          <p className="text-sm text-muted-foreground mt-1">Accédez à votre espace client sécurisé.</p>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")} className="mt-6">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">Se connecter</TabsTrigger>
              <TabsTrigger value="signup">Créer un compte</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-6">
              <form onSubmit={handleLogin} className="space-y-5" aria-label="Formulaire de connexion" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="l-email">E-mail</Label>
                  <Input
                    id="l-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    inputMode="email"
                    aria-required="true"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="l-password">Mot de passe</Label>
                  <div className="relative">
                    <Input
                      id="l-password"
                      name="password"
                      type={showLoginPwd ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      aria-required="true"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPwd((v) => !v)}
                      aria-label={showLoginPwd ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                      aria-pressed={showLoginPwd}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                      tabIndex={0}
                    >
                      {showLoginPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="pt-1 text-right">
                    <Link
                      to="/reset-password"
                      className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                    >
                      Mot de passe oublié ?
                    </Link>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Se connecter
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-6">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="s-prenom">Prénom</Label>
                    <Input id="s-prenom" name="prenom" required />
                  </div>
                  <div>
                    <Label htmlFor="s-nom">Nom</Label>
                    <Input id="s-nom" name="nom" required />
                  </div>
                </div>
                <div>
                  <Label htmlFor="s-email">E-mail</Label>
                  <Input id="s-email" name="email" type="email" required autoComplete="email" />
                </div>
                <div>
                  <Label htmlFor="s-password">Mot de passe</Label>
                  <div className="relative">
                    <Input
                      id="s-password"
                      name="password"
                      type={showSignupPwd ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignupPwd((v) => !v)}
                      aria-label={showSignupPwd ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                      aria-pressed={showSignupPwd}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                    >
                      {showSignupPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">8 caractères minimum. Un e-mail de vérification vous sera envoyé.</p>
                </div>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" name="accept_legal" required className="mt-0.5" />
                  <span>
                    J'ai lu et j'accepte les{" "}
                    <Link to="/cgu" target="_blank" className="underline text-primary">CGU</Link>{" "}
                    et la{" "}
                    <Link to="/politique-confidentialite" target="_blank" className="underline text-primary">Politique de confidentialité</Link>.
                  </span>
                </label>
                <Button className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Créer mon compte
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">ou</span>
            </div>
          </div>

          <div className="space-y-2">
            <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.5-1.6 4.3-5.4 4.3-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.9 14.6 3 12 3 6.9 3 2.8 7.1 2.8 12S6.9 21 12 21c7 0 9.3-4.9 9.3-7.4 0-.5-.1-.9-.1-1.4H12z"/></svg>
              Continuer avec Google
            </Button>
            <Button variant="outline" className="w-full" onClick={handleApple} disabled={loading}>
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor"><path d="M16.365 1.43c0 1.14-.42 2.22-1.13 3.02-.85.97-2.24 1.72-3.36 1.63-.14-1.12.42-2.28 1.15-3.02.83-.86 2.26-1.5 3.34-1.63zM20.5 17.28c-.55 1.27-.82 1.84-1.53 2.96-.99 1.56-2.38 3.5-4.1 3.51-1.53.01-1.92-1-4-.99-2.08.01-2.51 1.01-4.04 1-1.72-.01-3.04-1.76-4.03-3.32C.05 16.6-.24 11.5 1.42 8.79c1.18-1.92 3.04-3.05 4.79-3.05 1.78 0 2.9 1.01 4.37 1.01 1.43 0 2.3-1.01 4.36-1.01 1.56 0 3.21.85 4.39 2.31-3.86 2.12-3.23 7.63.17 9.23z"/></svg>
              Continuer avec Apple
            </Button>
          </div>
          <div className="mt-6 pt-4 border-t text-center text-xs text-muted-foreground space-x-3">
            <Link to="/mentions-legales" className="hover:underline">Mentions légales</Link>
            <Link to="/politique-confidentialite" className="hover:underline">Confidentialité</Link>
            <Link to="/cgu" className="hover:underline">CGU</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
