import { defineConfig } from "vitest/config";
import path from "path";

// Mirrors the "@/*" -> "./*" alias from jsconfig.json so test imports resolve
// the same way the Next.js app does.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") }
  },
  // (vitest 4's oxc transform handles .jsx with the automatic runtime out of
  // the box — no transform config needed.)
  test: {
    // Default to node; component tests opt into jsdom via a
    // `// @vitest-environment jsdom` directive at the top of the file.
    environment: "node",
    include: ["test/**/*.test.{js,jsx}"]
  }
});
