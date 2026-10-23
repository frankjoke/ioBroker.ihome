import js from "@eslint/js";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import typescriptParser from "@typescript-eslint/parser";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";
import svelteParser from "svelte-eslint-parser";

export default [
  {
    ignores: [
      "node_modules/",
      "build/",
      "www/",
      ".svelte-kit/",
      "coverage/",
      "*.tgz",
      // Scratch: the plan-execution workspaces (ledgers, briefs, review
      // packages, and whatever test tree a plan serves from here).
      ".superpowers/",
    ],
  },

  js.configs.recommended,

  ...svelte.configs["flat/recommended"],

  prettierConfig,

  {
    files: ["**/*.{js,ts,mjs,mts}"],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2020,
      sourceType: "module",
      globals: globals.node,
    },
    plugins: {
      prettier,
      "@typescript-eslint": typescriptPlugin,
    },
    rules: {
      // CommonJS adapter code (main.js, lib/, verify.js) uses require() deliberately
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: typescriptParser },
      ecmaVersion: 2020,
      sourceType: "module",
      globals: globals.browser,
    },
    plugins: {
      svelte,
      prettier,
    },
    rules: {
      "prettier/prettier": [
        "error",
        {
          parser: "svelte",
          plugins: ["prettier-plugin-svelte"],
        },
      ],
      // Script vars may be referenced from the template; svelte-check validates them
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
      // Hash navigation uses explicit `{base}/#/...` anchors (hash router type)
      "svelte/no-navigation-without-resolve": "off",
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    rules: {
      "prettier/prettier": "error",
    },
  },
  {
    files: ["**/*.{ts,mts}"],
    rules: {
      ...typescriptPlugin.configs.recommended.rules,
      "prettier/prettier": "error",
      // The adapter deals with dynamic ioBroker state/object payloads; `any` is
      // used deliberately at the JSON boundaries.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // CommonJS helper scripts (verify.cjs)
    files: ["**/*.cjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Mocha test runner globals (describe/it/expect) and template boilerplate
    files: ["test.adapter.js", "test/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        before: "readonly",
        after: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Runes modules (.svelte.js/.svelte.ts): script vars are referenced by
    // $state/$derived composition, and the modules use browser APIs at runtime
    files: ["**/*.svelte.js", "**/*.svelte.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // Vendored code uses idioMs like `value !== value` (NaN) and direct
      // hasOwnProperty calls that are intentional
      "use-isnan": "off",
      "no-prototype-builtins": "off",
      "no-empty": "off",
    },
  },
  {
    // Browser-only helpers (busy with node globals from the generic block)
    files: ["src/lib/localStorage.js", "src/lib/socket-url.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Service worker global scopes
    files: ["src/service-worker.js"],
    languageOptions: {
      globals: { self: "readonly", clients: "readonly", caches: "readonly" },
    },
  },
];
