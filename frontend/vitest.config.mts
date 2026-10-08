import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

// Same "@/..." alias as tsconfig, so component tests can import app code.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
