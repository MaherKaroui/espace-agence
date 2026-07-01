import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Réinitialiser le mot de passe" }] }),
  component: ResetPage,
});

function ResetPage() {
  const [mode, setMode] = useState<"request" | "update">("request");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash.includes("type=recovery")) setMode("update");
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("update");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const askReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = (new FormData(e.currentTarget).get("email") as string)?.trim();
    if (!email) return;
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) toast.error(error.message);
    else toast.success("Un lien de réinitialisation a été envoyé.");
  };

  const updatePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pwd = (new FormData(e.currentTarget).get("password") as string) ?? "";
    if (pwd.length < 8) { toast.error("8 caractères minimum"); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Mot de passe mis à jour");
      window.location.href = "/dashboard";
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md p-8">
        <h1 className="font-display text-2xl">Réinitialiser le mot de passe</h1>
        {mode === "request" ? (
          <form onSubmit={askReset} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <Button className="w-full" disabled={loading}>Envoyer le lien</Button>
            <a href="/auth" className="text-sm text-muted-foreground block text-center">Retour à la connexion</a>
          </form>
        ) : (
          <form onSubmit={updatePassword} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="password">Nouveau mot de passe</Label>
              <Input id="password" name="password" type="password" required minLength={8} />
            </div>
            <Button className="w-full" disabled={loading}>Mettre à jour</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
