import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "@sveltejs/adapter-static";

// The SvelteKit config lives here rather than in svelte.config.js: this package
// is CommonJS (main.js), so Node cannot import an ESM svelte.config.js.
export default defineConfig({
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({
        pages: "www",
        assets: "www",
        fallback: "index.html",
        precompress: false,
        strict: true,
      }),
      paths: {
        base: process.env.NODE_ENV === "production" ? "/ihome" : "",
      },
      router: {
        type: "hash",
      },
      serviceWorker: {
        // registered in +layout.svelte, with updateViaCache: "none"
        register: false,
      },
      version: {
        pollInterval: 0,
      },
      output: {
        bundleStrategy: "inline",
      },
    }),
  ],
  server: {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    // The project lives under OneDrive, whose file events get swallowed: Vite
    // missed edits and kept serving the previous module until the dev server
    // was restarted. Polling is the documented remedy for sync/network folders
    // (it costs a little CPU in exchange for never being stale).
    watch: {
      usePolling: true,
      interval: 300,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,ts}"],
    expect: {
      requireAssertions: true,
    },
  },
});
