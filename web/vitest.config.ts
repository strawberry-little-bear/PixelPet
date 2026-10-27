import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    restoreMocks: true,
    setupFiles: ["./src/focused-test-window.ts"],
    // jsdom startup is expensive on this project. A single worker avoids
    // intermittent worker-launch timeouts while keeping file isolation.
    pool: "threads",
    maxWorkers: 1,
    testTimeout: 30000,
  },
});
