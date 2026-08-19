import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * Route d'entrée : simple aiguillage.
 * Le rendu est strictement identique côté serveur et côté client (un simple
 * écran de chargement statique), et la lecture de session — qui n'existe que
 * dans le navigateur — se fait dans un useEffect. C'est ce qui évite le
 * mismatch d'hydratation que provoquait `ssr: false` (le serveur n'envoyait
 * qu'un fallback Suspense là où le client montait l'arbre complet).
 */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "IZISuivis — Suivi de dossiers Qualiopi, BPF et NDA" },
      {
        name: "description",
        content:
          "Accédez à votre espace IZISuivis pour suivre vos dossiers Qualiopi, BPF, NDA, CFA et VAE et échanger avec votre agence.",
      },
      { property: "og:title", content: "IZISuivis — Suivi de dossiers Qualiopi, BPF et NDA" },
      {
        property: "og:description",
        content:
          "Accédez à votre espace IZISuivis pour suivre vos dossiers et échanger avec votre agence en toute sécurité.",
      },
    ],
  }),
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      navigate({ to: data.session ? "/dashboard" : "/auth", replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Chargement" />
    </div>
  );
}
