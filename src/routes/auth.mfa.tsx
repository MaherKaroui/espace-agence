import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ShieldCheck, Loader2, KeyRound } from "lucide-react";

export const Route = createFileRoute("/auth/mfa")({
  head: () => ({ meta: [{ title: "Vérification à deux facteurs — Espace Agence" }] }),
  component: MfaPage,
});

type Mode = "loading" | "enroll" | "verify";

function MfaPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) { navigate({ to: "/auth" }); return; }

      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      // Déjà authentifié aal2 → passer
      if (aal?.currentLevel === "aal2") { navigate({ to: "/dashboard" }); return; }

      const { data: factors, error } = await supabase.auth.mfa.listFactors();
      if (error) { toast.error("Impossible de vérifier le 2FA"); return; }
      const verified = factors?.totp?.find((f) => f.status === "verified");

      if (verified) {
        setFactorId(verified.id);
        setMode("verify");
        return;
      }

      // Nettoyer un facteur non vérifié résiduel
      const unverified = factors?.totp?.find((f) => f.status !== "verified");
      if (unverified) await supabase.auth.mfa.unenroll({ factorId: unverified.id });

      // Nouveau facteur
      const { data: enroll, error: enErr } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (enErr || !enroll) { toast.error("Enrôlement 2FA impossible"); return; }
      setFactorId(enroll.id);
      setQr(enroll.totp.qr_code);
      setSecret(enroll.totp.secret);
      setMode("enroll");
    })();
  }, [navigate]);

  const submit = async () => {
    if (!factorId || code.length < 6) { toast.error("Entrez un code à 6 chiffres"); return; }
    setBusy(true);
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr || !ch) { setBusy(false); toast.error("Échec du challenge 2FA"); return; }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    setBusy(false);
    if (vErr) { toast.error("Code invalide"); return; }
    toast.success("2FA vérifié");
    navigate({ to: "/dashboard" });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-gold" />
          </div>
          <div>
            <h1 className="font-display text-xl">Authentification à deux facteurs</h1>
            <p className="text-xs text-muted-foreground">Obligatoire · Sécurité renforcée</p>
          </div>
        </div>

        {mode === "loading" && <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}

        {mode === "enroll" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scannez ce QR code avec <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong> ou <strong>1Password</strong>.
            </p>
            {qr && (
              <div className="flex justify-center bg-white p-4 rounded-md border">
                <img src={qr} alt="QR code 2FA" className="h-48 w-48" />
              </div>
            )}
            {secret && (
              <div className="text-xs text-center">
                <span className="text-muted-foreground">Ou saisissez cette clé : </span>
                <code className="font-mono bg-muted px-2 py-1 rounded">{secret}</code>
              </div>
            )}
            <div>
              <Label htmlFor="code">Code à 6 chiffres généré</Label>
              <Input id="code" inputMode="numeric" pattern="\d{6}" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            <Button className="w-full" onClick={submit} disabled={busy || code.length !== 6}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Activer le 2FA
            </Button>
          </div>
        )}

        {mode === "verify" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-md bg-muted p-3">
              <KeyRound className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                Ouvrez votre application d'authentification et saisissez le code à 6 chiffres.
              </p>
            </div>
            <div>
              <Label htmlFor="code">Code à 6 chiffres</Label>
              <Input id="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoFocus
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            <Button className="w-full" onClick={submit} disabled={busy || code.length !== 6}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Vérifier
            </Button>
          </div>
        )}

        <button onClick={signOut} className="mt-6 w-full text-xs text-muted-foreground hover:text-foreground">
          Se déconnecter
        </button>
      </Card>
    </div>
  );
}
