import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { LEGAL_VERSIONS } from "@/lib/legal-versions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

/**
 * Bandeau affiché à la première connexion (ou après mise à jour des documents légaux)
 * si l'utilisateur n'a pas encore accepté la version courante des CGU / Politique / Journalisation.
 */
export function ConsentBanner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [checked, setChecked] = useState(false);

  const { data: latestConsents } = useQuery({
    queryKey: ["latest-consents", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("consents")
        .select("document_type, version, accepted_at")
        .eq("user_id", user.id)
        .order("accepted_at", { ascending: false });
      const latest: Record<string, string> = {};
      (data ?? []).forEach((c) => {
        if (!latest[c.document_type]) latest[c.document_type] = c.version;
      });
      return latest;
    },
    enabled: !!user,
  });

  const missing: Array<"cgu" | "privacy" | "logging_notice"> = [];
  if (latestConsents !== undefined && latestConsents !== null) {
    if (latestConsents.cgu !== LEGAL_VERSIONS.cgu) missing.push("cgu");
    if (latestConsents.privacy !== LEGAL_VERSIONS.privacy) missing.push("privacy");
    if (latestConsents.logging_notice !== LEGAL_VERSIONS.logging_notice) missing.push("logging_notice");
  }

  useEffect(() => { setChecked(false); }, [user?.id]);

  const handleAccept = async () => {
    if (!user || missing.length === 0) return;
    setSubmitting(true);
    const rows = missing.map((t) => ({
      user_id: user.id,
      document_type: t,
      version: LEGAL_VERSIONS[t],
      user_agent: navigator.userAgent,
    }));
    await supabase.from("consents").insert(rows);
    setSubmitting(false);
    qc.invalidateQueries({ queryKey: ["latest-consents", user.id] });
    qc.invalidateQueries({ queryKey: ["consents", user.id] });
  };

  if (!user || !latestConsents || missing.length === 0) return null;

  const needsCguOrPrivacy = missing.includes("cgu") || missing.includes("privacy");

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg p-6">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg">
            {needsCguOrPrivacy ? "Acceptation requise" : "Information importante"}
          </h2>
        </div>
        {needsCguOrPrivacy ? (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              Pour continuer, merci de lire et d'accepter les documents suivants :
            </p>
            <ul className="text-sm space-y-1 mb-4">
              {missing.includes("cgu") && (
                <li>• <Link to="/cgu" target="_blank" className="text-primary underline">Conditions Générales d'Utilisation</Link></li>
              )}
              {missing.includes("privacy") && (
                <li>• <Link to="/politique-confidentialite" target="_blank" className="text-primary underline">Politique de confidentialité</Link></li>
              )}
            </ul>
            <label className="flex items-start gap-2 text-sm mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5"
              />
              <span>J'ai lu et j'accepte les documents ci-dessus.</span>
            </label>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              Pour votre sécurité, vos connexions et actions sur la plateforme sont journalisées à des fins de traçabilité.
              Ces informations sont conservées 12 mois puis purgées automatiquement.
            </p>
          </>
        )}
        <div className="flex justify-end">
          <Button
            onClick={handleAccept}
            disabled={submitting || (needsCguOrPrivacy && !checked)}
          >
            {needsCguOrPrivacy ? "Accepter et continuer" : "J'ai compris"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
