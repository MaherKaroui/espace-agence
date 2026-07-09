import { auth, defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";

// OAuth issuer MUST be the direct Supabase host (not the .lovable.cloud proxy).
// VITE_SUPABASE_PROJECT_ID is inlined at build time by Vite.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "espace-agence-mcp",
  title: "IZISuivis MCP",
  version: "0.1.0",
  instructions:
    "Outils MCP pour IZISuivis. Utilisez `echo` pour vérifier la connectivité.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [echoTool],
});
