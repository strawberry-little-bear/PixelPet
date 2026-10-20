import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
});
