import { defineConfig } from "vitest/config";
import path from "path";

// Mirrors the "@/*" -> "./*" alias from jsconfig.json so test imports resolve
// the same way the Next.js app does.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.js"]
  }
});
