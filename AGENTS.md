# AGENTS.md — iobroker-visual-adapter

## Handoffs

- Session handoff documents live in **`docs/progress/`**.
- **At the start of every session:** read the most recent handoff there
  (filename pattern `handoff-YYYY-MM-DD-*.md`, newest by date) to learn what the
  previous session did.
- **When writing a new handoff:** save it into `docs/progress/` following the same
  `handoff-YYYY-MM-DD-iobroker-visual-adapter.md` naming.
- **`docs/` is local-only** (gitignored): handoffs and the design record are never
  committed or pushed — write them, don't `git add` them (an ignored path makes the
  commit fail).

## Branching

- New features and multi-step changes go on a branch in the **main checkout**
  (`git switch -c feat/...`), not in a separate worktree.
- Merge to `main` when done and delete the branch. Keep one working directory;
  this avoids stale dev servers and duplicate module instances.

## UI

- **Before any UI change, read `docs/UI-DESIGN.md` and follow it.** It is the
  source of truth for tokens, page anatomy, lists/rows and buttons.
- **For data-model or cross-layer work, read `docs/App-structure.md`.** It
  defines states, objects, devices, controls, pages/sections/tiles/slots,
  variables, templates, logic and how they reference each other.
- Every configuration ("cog") page uses the one list-editor pattern from §5:
  an `.item` with a clickable `.item-line`, the name as the open/close control,
  and right-aligned `.item-actions` (IconButton for export/duplicate/delete, a
  primary `.btn-sm` Save only while open and dirty). Never add text-only
  Edit/Export buttons, a second editor header, or a footer action row.
- Reference implementations: `src/routes/logic/+page.svelte`,
  `src/routes/devices/+page.svelte`,
  `src/lib/components/templates/CodeTemplates.svelte`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ioBroker.ihome** (2548 symbols, 6381 relationships, 216 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/ioBroker.ihome/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ioBroker.ihome/clusters` | All functional areas |
| `gitnexus://repo/ioBroker.ihome/processes` | All execution flows |
| `gitnexus://repo/ioBroker.ihome/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
