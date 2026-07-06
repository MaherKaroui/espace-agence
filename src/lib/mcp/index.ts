import { defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";

export default defineMcp({
  name: "espace-agence-mcp",
  title: "IZISuivis MCP",
  version: "0.1.0",
  instructions:
    "Outils MCP pour IZISuivis. Utilisez `echo` pour vérifier la connectivité.",
  tools: [echoTool],
});
