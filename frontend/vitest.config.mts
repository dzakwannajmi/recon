import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

// Same "@/..." alias as tsconfig, so component tests can import app code.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    // @x402/next imports "next/server" without the .js extension: let Vite resolve it instead of Node.
    server: { deps: { inline: [/@x402\/next/] } },
  },
});
