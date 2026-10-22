---
phase: 261022-up1
plan: 01
subsystem: transport
tags: [websocket, iobroker, svelte, vite, pwa, configuration]

# Dependency graph
requires: []
provides:
  - "@iobroker/ws 3.1.3 as the SPA's socket client (devDependency, bundled into the committed www/)"
  - "src/lib/broker-config.ts — the one configured broker fallback (host:port, committed empty)"
  - "src/lib/socket-url.ts — socketUrlFromHostPort + resolveSocketUrl (one home for the URL rule and its precedence)"
  - "src/lib/socket-client.test.ts — the adopted package's entry-point contract"
  - "a rebuilt, committed www/ carrying the adopted client and no installation-specific broker address"
affects: [phase 2 (INSTALL-06 second clause superseded), anything touching the socket transport, icon URLs or the settings page]

# Actuals (#2632) — pairs with the plan's `estimate` (120000 tokens) to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff, dafa71e..HEAD = 804670 bytes).
# 13100 of the 201000 tokens are the hand-written source/record diff; the rest is the rebuilt www/ bundle.
actuals:
  tokens: 201000
  tasks: 3
  commits: 3

tech-stack:
  added: ["@iobroker/ws 3.1.3 (devDependency; zero runtime dependencies, bundled into www/)"]
  patterns: ["one resolution function per derived value — resolveSocketUrl names the order so no caller holds a competing notion of 'the broker'"]

key-files:
  created: [src/lib/broker-config.ts, src/lib/socket-client.test.ts]
  modified: [src/lib/ioBrokerConnect.svelte.js, src/lib/socket-url.ts, src/lib/socket-url.test.ts, src/lib/utils/icon-url.ts, src/lib/utils/icon-url.test.ts, src/routes/+layout.svelte, src/routes/settings/+page.svelte, package.json, package-lock.json, eslint.config.mjs]
  deleted: [src/lib/iobroker.socket.io.js]

key-decisions:
  - "Adopted @iobroker/ws (the upstream of the deleted vendored copy), not the description's @iobroker/socket-client: that package is the admin/vis Connection API driven through a server-served global `io` script and its exported SocketClient is a type only — adopting it would be a transport rewrite, not a swap"
  - "The client is a devDependency: it is compiled into the committed www/, so the published package keeps exactly one runtime dependency (@iobroker/adapter-core)"
  - "FALLBACK_BROKER is committed empty — www/ ships in the tarball, so a pinned private address would point every other installation at someone else's LAN"
  - "The adopted client connects inside io.connect(): the create path connects immediately and the reused-client path reconnects explicitly (socket.connect(url, roptions)); the old post-handler connect call was removed"
  - "Timed-out emit callbacks: upstream 3.1 answers a callback after callbackTimeout (default 30 s) with the string 'timeout'; our own 15 s/30 s RPC timeouts still fire first and a second reject on a settled promise is a no-op — observation only, no change made"

requirements-completed: [UP1-R1, UP1-R2] # the two clauses of the quick-task description; no ROADMAP id applies

coverage:
  - id: D1
    description: "The SPA's transport is the published @iobroker/ws client; no hand-copied client remains in src/"
    requirement: "UP1-R1"
    verification:
      - kind: unit
        ref: "src/lib/socket-client.test.ts#the package's entry point provides the client the SPA drives"
        status: pass
      - kind: other
        ref: "grep -rn 'iobroker\\.socket\\.io' src/ eslint.config.mjs | wc -l → 0 (baseline 3)"
        status: pass
      - kind: other
        ref: "grep -rl callbackTimeout www/ → www/index.html (the adopted client is in the shipped bundle)"
        status: pass
    human_judgment: true
    rationale: "The swap is only proven when the built SPA actually connects to a real broker (plan check H1/H2 against 192.168.178.9). The executor has no browser; the human check is pending."
  - id: D2
    description: "With no connection data and nothing stored, the socket URL comes from one configured broker value instead of the page's host, and the icon base reads the same broker"
    requirement: "UP1-R2"
    verification:
      - kind: unit
        ref: "src/lib/socket-url.test.ts#resolveSocketUrl (configured wins over the page host; query wins over configured; env wins over configured; empty configured → page host incl. wss)"
        status: pass
      - kind: unit
        ref: "src/lib/utils/icon-url.test.ts#iconBase uses the configured broker fallback when nothing is stored"
        status: pass
    human_judgment: true
    rationale: "Requires the built PWA opened from a non-broker origin (localhost:4173) to reach the broker's ihome.0 namespace — plan check H1, pending a human."
  - id: D3
    description: "The shipped bundle carries no installation-specific broker address (the committed default stays empty)"
    requirement: "UP1-R2"
    verification:
      - kind: other
        ref: "grep -rl '192\\.168\\.178\\.9' www/ | wc -l → 0 (baseline 0)"
        status: pass
      - kind: unit
        ref: "grep -c 'FALLBACK_BROKER = \"\"' src/lib/broker-config.ts → 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "The broker-served origin still resolves ws(s)://<page-host>:8081/socket.io, byte-for-byte as before"
    requirement: ""
    verification:
      - kind: unit
        ref: "src/lib/socket-url.test.ts#defaultSocketUrl (the four pre-existing cases, unchanged)"
        status: pass
    human_judgment: true
    rationale: "The plan check H2 (broker-served origin 192.168.178.9:8082/ihome/index.html, live tiles, an edit persists) has not been run — pending a human."

duration: ~10 min
completed: 2026-10-22
status: complete
---

# Quick task 261022-up1 Summary

**The hand-vendored ioBroker WebSocket client is replaced by its published upstream `@iobroker/ws` 3.1.3, and the broker address now has one configured home (`FALLBACK_BROKER`, host:port, committed empty) feeding both the socket URL and the icon base — with `www/` rebuilt and committed.**

## Performance

- **Duration:** ~10 min (22:16 → 22:23 local; plan `dafa71e` → HEAD `30e3136`)
- **Tasks:** 3 / 3 automatable
- **Files changed:** 26 (3 code commits; 13 files in the final bundle+record commit)
- **Gates:** 399/399 unit (was 391), 46/46 package, `npm run check` 0 errors/0 warnings, `npm run lint` 0

## Task Commits

1. **Task 1: Adopt the published client (`@iobroker/ws`) and delete the vendored copy** — `614c5ad` (refactor)
2. **Task 2: Configured broker fallback — one home for the URL rule and its precedence** — `e7103dd` (feat)
3. **Task 3: Rebuild the shipped bundle, run the gates, refresh the record** — `30e3136` (build)

Measured (ledger base `dafa71e71ded4ae6bfbe35b20e364891eb072524` → HEAD `30e31361773b3a1e71a647c917f0421768ff79b9`, `git rev-list --count` = 3).

## Accomplishments

- `src/lib/iobroker.socket.io.js` (413 lines, hand-vendored v3.0.4) is **gone**; nothing in `src/` or `eslint.config.mjs` references it (gate: 3 → 0). The transport creates its client through the package's only entry point: side-effect import + `globalThis.io.connect(url, roptions)`; the reused-client path reconnects explicitly.
- `@iobroker/ws` 3.1.3 is a **devDependency** (bundled, not shipped); `package-lock.json` carries the integrity hash; the published package's runtime dependency count stays at one.
- `src/lib/broker-config.ts` holds `FALLBACK_BROKER` (`host:port`, committed **empty**) and `src/lib/socket-url.ts` implements exactly one precedence for the socket URL: `VITE_SOCKET_URL` → `?socket=` → configured fallback → `ws(s)://<page-host>:8081/socket.io`. `+layout.svelte` (via `socketUrlFromHostPort`) and `icon-url.ts` both read it; both settings descriptions of an empty Host:Port name the fallback first.
- `www/` rebuilt and committed: marker gate `grep -rl callbackTimeout www/` → `www/index.html`; address gate `grep -rl "192\.168\.178\.9" www/ | wc -l` → `0` (run last, immediately before the commit).
- The record is refreshed: seven `.planning/codebase/` files, the `PROJECT.md` decision row (`⚠️ Revisit` → ✅ replaced), the `REQUIREMENTS.md` INSTALL-06 supersession note, and a new "quick task 261022-up1" section in `docs/progress/handoff-2026-10-22-iobroker-visual-adapter.md` (revert recipe + pending human check included).

## Files Created/Modified

- `src/lib/broker-config.ts` — the single configured broker fallback (`host:port`), committed empty, with the "why empty" contract in its doc comment
- `src/lib/socket-client.test.ts` — pins the adopted package's entry-point contract (`globalThis.io.connect`, `emit/on/off/close/disconnect/destroy`, `connected === false`) with a do-nothing `WebSocket` stub so no real socket opens
- `src/lib/socket-url.ts` — `socketUrlFromHostPort` + `resolveSocketUrl`; `defaultSocketUrl` is a thin reader of the page's own sources
- `src/lib/socket-url.test.ts` — the four existing `defaultSocketUrl` cases unchanged, plus `socketUrlFromHostPort` and the `resolveSocketUrl` precedence cases
- `src/lib/utils/icon-url.ts` / `icon-url.test.ts` — `iconBase()` reads stored Host:Port → configured fallback → `location.origin`; a `vi.doMock` case pins the fallback path
- `src/lib/ioBrokerConnect.svelte.js` — package import + `globalThis.io.connect`, JSDoc type `import("@iobroker/ws").SocketClient`, else-branch reconnect, old post-handler `socket.connect(...)` removed
- `src/routes/+layout.svelte` — `buildUrl` = `socketUrlFromHostPort(storage.hostPort) || defaultSocketUrl()`
- `src/routes/settings/+page.svelte` — both empty-Host:Port descriptions name the fallback first
- `package.json` / `package-lock.json` — `@iobroker/ws@^3.1.3` in devDependencies
- `eslint.config.mjs` — the deleted file's override block removed (the runes-modules block above it untouched)
- `www/` — rebuilt bundle (index.html, service-worker.js, version.json)
- `src/lib/iobroker.socket.io.js` — **deleted**

## Decisions Made

- **Package choice:** `@iobroker/ws`, not the description's `@iobroker/socket-client` — the latter is the admin/vis `Connection` API whose `SocketClient` export is a type only and which expects a server-served global `io`; adopting it would rebuild the transport. Recorded as the plan's documented deviation from the description.
- **Empty committed default** for `FALLBACK_BROKER`, enforced by a source gate and a bundle gate (T-UP1-03).
- **devDependency placement:** `www/` is committed and shipped prebuilt, so consumers must not install a browser library; `dependencies` stays `@iobroker/adapter-core` alone.

## Deviations from Plan

None — the plan executed as written, except that Task 3's commit was made **before** the human check (H1/H2) instead of after it: the check cannot run without a browser, and the plan's own ordering assumed the check precedes the commit. The commit carries the empty-fallback bundle (the state H2's restore-rebuild would produce), which is exactly what both bundle gates require, so the artifact is the one the plan wants committed. If the human check fails, the plan's revert recipe applies and the branch is abandoned anyway. Recorded here rather than silently.

## Issues Encountered

- `it is not defined` in the new test file: this repo does not enable vitest globals — fixed by importing `{ expect, it } from "vitest"`.
- Two prettier errors on `src/routes/settings/+page.svelte` after hand-wrapping the new hint text (CRLF file vs LF-inserted breaks) — fixed with `eslint --fix`.

## Human check — PENDING (Task 3)

**H1 and H2 were NOT run** — the executing agent cannot drive a browser. Everything automatizable is done and green; the real-broker claim remains unproven until a human runs:

1. **H1 (UP1-R1 + UP1-R2 in one pass):** set `FALLBACK_BROKER = "192.168.178.9:8081"` in `src/lib/broker-config.ts`, `npm run build && npm run preview`, open `http://localhost:4173/ihome/` (no `VITE_SOCKET_URL` masking it). Expect: footer connected for `ihome.0`, live tiles, device icons, a control toggles broker state, no "Failed to connect" / "No READY flag received in 3 seconds" in the console.
2. **H2 (the everyday path):** set `FALLBACK_BROKER` back to empty, `npm run build` (so the committed bundle stays unpinned), `npm run deploy:www`, open `http://192.168.178.9:8082/ihome/index.html`: connected, live tiles, an edit persists. Optional: `npm run test:integration`.
3. **H3 (if either fails):** `git switch main && git branch -D quick/261022-up1-websocket-client` — nothing outside this branch was touched.

Note: H1 deliberately pins the address and rebuilds; after H2's restore-rebuild the working tree should be clean against commit `30e3136` (the committed bundle is the empty-fallback build).

## Observation — upstream 3.1 callback timeout

Upstream 3.1 answers an `emit` whose callback has not returned after `callbackTimeout` (default 30 s) by calling the callback with the string `'timeout'`. The SPA's own RPC timeouts (15 s `emitAsync`, 30 s `emitAsyncNoErr`) still fire first, and a second reject on an already-settled deferred promise is a no-op — so behavior is unchanged. Recorded, not "fixed" (as the plan directs).

## Known Stubs

None — no placeholder values, no unwired data sources introduced by this task.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary changes beyond the ones already in the plan's `<threat_model>` (T-UP1-01…04 all addressed: verified publisher/provenance, pinned lockfile + contract test, empty committed default + bundle address gate, unchanged `ws://` posture).

## Next Phase Readiness

- Phase 1 work is unaffected; Phase 2's INSTALL-06 now has only its `engines.node` half open (the client clause is marked superseded in `REQUIREMENTS.md`).
- Merge readiness depends on the pending H1/H2 human check.

---

*Quick task: 261022-up1*
*Completed: 2026-10-22*

## Self-Check: PASSED

- Created files present: `src/lib/broker-config.ts`, `src/lib/socket-client.test.ts`, `www/index.html`, this SUMMARY.
- Deleted as planned: `src/lib/iobroker.socket.io.js` absent.
- Commits reachable from HEAD: `614c5ad`, `e7103dd`, `30e3136` (ledger-measured count 3).
