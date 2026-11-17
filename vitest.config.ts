// Config minimale, volontairement indépendante de vite.config.ts
// (qui charge toute la pile TanStack Start / Lovable).
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"] },
});
