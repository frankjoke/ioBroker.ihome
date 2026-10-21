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
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,ts}"],
    expect: {
      requireAssertions: true,
    },
  },
});
