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
import { ShieldCheck, Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — Espace Client" },
      { name: "description", content: "Connectez-vous ou créez votre compte pour accéder à votre espace client." },
    ],
  }),
  component: AuthPage,
});

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
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

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
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { nom, prenom },
      },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Compte créé. Vérifiez votre e-mail pour l'activer.");
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
    navigate({ to: "/dashboard" });
  };

  const handleGoogle = async () => {
    setLoading(true);
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (res.error) { setLoading(false); toast.error("Connexion Google impossible"); return; }
    if (res.redirected) return;
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex bg-gradient-hero text-white p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-gold flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <span className="font-display text-xl">Espace Agence</span>
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
        <p className="text-xs text-white/40">© {new Date().getFullYear()} — Agence</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <Card className="w-full max-w-md p-8 border-border shadow-sm">
          <div className="mb-6 lg:hidden flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-gold" />
            </div>
            <span className="font-display text-lg">Espace Agence</span>
          </div>
          <h2 className="font-display text-2xl">Bienvenue</h2>
          <p className="text-sm text-muted-foreground mt-1">Accédez à votre espace client sécurisé.</p>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")} className="mt-6">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">Se connecter</TabsTrigger>
              <TabsTrigger value="signup">Créer un compte</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-6">
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <Label htmlFor="l-email">E-mail</Label>
                  <Input id="l-email" name="email" type="email" required autoComplete="email" />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="l-password">Mot de passe</Label>
                    <Link to="/reset-password" className="text-xs text-muted-foreground hover:text-foreground">Mot de passe oublié ?</Link>
                  </div>
                  <Input id="l-password" name="password" type="password" required autoComplete="current-password" />
                </div>
                <Button className="w-full" disabled={loading}>
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
                  <Input id="s-password" name="password" type="password" required minLength={8} autoComplete="new-password" />
                  <p className="text-xs text-muted-foreground mt-1">8 caractères minimum. Un e-mail de vérification vous sera envoyé.</p>
                </div>
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

          <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
            <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.5-1.6 4.3-5.4 4.3-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.9 14.6 3 12 3 6.9 3 2.8 7.1 2.8 12S6.9 21 12 21c7 0 9.3-4.9 9.3-7.4 0-.5-.1-.9-.1-1.4H12z"/></svg>
            Continuer avec Google
          </Button>
        </Card>
      </div>
    </div>
  );
}
