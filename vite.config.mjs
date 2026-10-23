import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "@sveltejs/adapter-static";

// The SvelteKit config lives here rather than in svelte.config.js: this package
// is CommonJS (main.js), so Node cannot import an ESM svelte.config.js.
export default defineConfig(({ mode }) => {
  // Dev-only convenience: in production the *web adapter* serves both the app
  // and the other adapters' UIs, so an iFrame slot can use a relative URL
  // (/echarts/…) and it resolves. In dev those paths belong to no server, so
  // forward them to the broker that serves them — point VITE_PROXY_TARGET at
  // that web adapter in the untracked .env.development.local
  // (e.g. VITE_PROXY_TARGET=http://192.168.1.10:8082). The address stays out of
  // this tracked file on purpose.
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_PROXY_TARGET || "http://localhost:8082";

  return {
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
      // Add further adapter paths here if an iFrame uses them. `/socket.io` is
      // free in dev (the app talks to the broker's ws-server through
      // VITE_SOCKET_URL), and proxying it keeps an iFrame's own live data
      // working under the dev server too.
      proxy: {
        "/echarts": { target: proxyTarget, changeOrigin: true, ws: true },
        "/energiefluss": { target: proxyTarget, changeOrigin: true, ws: true },
        "/socket.io": { target: proxyTarget, changeOrigin: true, ws: true },
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.{test,spec}.{js,ts}"],
      expect: {
        requireAssertions: true,
      },
    },
  };
});
