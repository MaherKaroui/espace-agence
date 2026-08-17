import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/oauth/google-drive/return")({
  head: () => ({
    meta: [
      { title: "Connexion Google Drive — IZISuivis" },
      { name: "description", content: "Finalisation de la connexion Google Drive à votre espace IZISuivis." },
      { property: "og:title", content: "Connexion Google Drive — IZISuivis" },
      { property: "og:description", content: "Finalisation de la connexion Google Drive à votre espace IZISuivis." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OAuthReturn,
});

function OAuthReturn() {
  const [message, setMessage] = useState("Finalisation de la connexion…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const notify = (
      type: "appUserConnectorOAuthComplete" | "appUserConnectorOAuthFailed",
      code?: string,
    ) => {
      window.opener?.postMessage(
        { type, connectorId: "google_drive", code: code ?? null },
        window.location.origin,
      );
      window.close();
    };

    if (params.get("success") !== "true") {
      setMessage(params.get("error") ?? "La connexion n'a pas abouti.");
      notify("appUserConnectorOAuthFailed");
      return;
    }
    const code = params.get("code");
    if (!code) {
      if (params.get("offline_access_allowed") === "false") {
        notify("appUserConnectorOAuthComplete");
        return;
      }
      setMessage("Connexion terminée sans code d'échange.");
      notify("appUserConnectorOAuthFailed");
      return;
    }
    notify("appUserConnectorOAuthComplete", code);
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <p className="text-muted-foreground">{message}</p>
    </main>
  );
}
