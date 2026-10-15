import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "@sveltejs/adapter-static";

const config = {
  preprocess: vitePreprocess(),
  kit: {
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
  },
};

export default config;
