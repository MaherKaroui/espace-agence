import { defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";

export default defineMcp({
  name: "espace-agence-mcp",
  title: "Espace Agence MCP",
  version: "0.1.0",
  instructions:
    "Outils MCP pour l'Espace Agence. Utilisez `echo` pour vérifier la connectivité.",
  tools: [echoTool],
});
