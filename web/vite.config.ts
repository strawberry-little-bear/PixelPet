import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Read once at build time; never ask the running page to infer GitHub's HEAD.
function webBuild() {
  try {
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
    const revision = git("rev-parse", "HEAD");
    if (!/^[0-9a-f]{40,64}$/.test(revision)) return {};
    return { revision, modified: git("status", "--porcelain", "--untracked-files=normal") !== "" };
  } catch { return {}; }
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: { __PIXELPET_WEB_BUILD__: JSON.stringify(command === "build" ? webBuild() : { development: true }) },
  build: {
    rollupOptions: {
      output: {
        // Keep the stable runtime cacheable across game/content updates. This
        // is an eager dependency, not lazy gameplay or a lower first-load total.
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id.replaceAll("\\", "/"))) {
            return "react-vendor";
          }
        },
      },
    },
  },
  server: {
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8080", changeOrigin: false } },
  },
}));
