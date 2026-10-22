---
phase: 261022-up1
verified: 2026-10-22T20:27:46Z
status: human_needed
score: 5/7 must-haves verified
covered_files: [".planning/quick/261022-up1-replace-the-vendored-iobroker-websocket-/261022-up1-PLAN.md", ".planning/quick/261022-up1-replace-the-vendored-iobroker-websocket-/261022-up1-SUMMARY.md", "eslint.config.mjs", "package-lock.json", "package.json", "src/lib/broker-config.ts", "src/lib/ioBrokerConnect.svelte.js", "src/lib/socket-client.test.ts", "src/lib/socket-url.test.ts", "src/lib/socket-url.ts", "src/lib/utils/icon-url.test.ts", "src/lib/utils/icon-url.ts", "src/routes/+layout.svelte", "src/routes/settings/+page.svelte", "www/_app/version.json", "www/index.html", "www/service-worker.js"]
covered_digest: "v3:sha256:70abf51ed4929c4894529da6517560b2a7a9d96032f92748a513b77f8e795119"
behavior_unverified: 2
overrides_applied: 0
behavior_unverified_items:
  - truth: "The SPA speaks the ioBroker WebSocket protocol through the published client (the runtime half of truth 1)"
    test: "Root the built SPA at the broker it is configured for and let it run: set `FALLBACK_BROKER = \"192.168.178.9:8081\"`, `npm run build && npm run preview`, open `http://localhost:4173/ihome/` with no `VITE_SOCKET_URL` set (plan check H1)."
    expected: "The connection footer reports connected for namespace `ihome.0`, tiles show live values that follow the device, a control toggle changes the broker state, and the console shows neither `Failed to connect to Socket.IO server` nor `No READY flag received in 3 seconds`."
    why_human: "The contract test pins the package's entry point (`globalThis.io.connect` plus the `emit/on/off/close/disconnect/destroy/connected` surface) using a do-nothing `WebSocket` stub, so it never opens a socket. Nothing in the suite exercises a real broker handshake or the wire protocol, so symbol presence, wiring and the contract test cannot see whether the handshake, the READY flag, or the state round-trip actually work."
  - truth: "The built SPA opened from a non-broker origin with the fallback set reaches the broker's namespace `ihome.0` (truth 3)"
    test: "Same run as above (plan check H1) — the page host is `localhost`, so the configured fallback is the only path by which it can reach the broker."
    expected: "Connected footer for `ihome.0`, live tiles, device icons rendered (that also exercises the icon base against the same broker), and a write that persists to the broker as observed from another client."
    why_human: "Requires a browser, a live broker on the LAN, and a build with the fallback pinned. No automated test can construct the origin mismatch (page served from `localhost`, socket pointed at `192.168.178.9`) or observe the resulting connection."
human_verification:
  - test: "H1 — locally started PWA via the configured fallback. Set `FALLBACK_BROKER = \"192.168.178.9:8081\"` in `src/lib/broker-config.ts`, then `npm run build && npm run preview`, and open `http://localhost:4173/ihome/` (the base path from `vite.config.mjs`; use the URL preview prints if it differs). Make sure no `VITE_SOCKET_URL` in the shell or `.env.development.local` masks the fallback. Hard-reload if the page looks stale — a production build registers the service worker on localhost."
    expected: "Connected footer for `ihome.0`; tiles render live values; device icons render (exercises the icon base); toggling a control changes the broker state; console free of `Failed to connect to Socket.IO server` and `No READY flag received in 3 seconds`."
    why_human: "Needs a browser and the live broker at 192.168.178.9; no test in the repo opens a socket. This is the only check that proves the swap works end-to-end and that the fallback is what connects."
  - test: "H2 — the everyday broker-served path. Set `FALLBACK_BROKER` back to `\"\"`, `npm run build` (so the committed bundle stays unpinned), `npm run deploy:www` (with `IOBROKER_MCP` as usual), then open `http://192.168.178.9:8082/ihome/index.html`."
    expected: "Connected, live tiles, an edit persists. Optional: `npm run test:integration` against the live controller."
    why_human: "Confirms the swap did not break the origin the app ships to; requires the live web adapter and a browser."
  - test: "Restore after H1 — the working tree must return to commit `30e3136` once H1 is done."
    expected: "`git checkout -- src/lib/broker-config.ts www/` (or an equivalent restore) leaves `git status --porcelain` showing nothing but the untracked SUMMARY. The committed bundle is already the empty-fallback build; H1 deliberately dirties both files."
    why_human: "A human runs H1 by hand and leaves the tree in whatever state they left it; an automated check cannot see whether the pinned value was restored."
---

# Phase 261022-up1: Replace the vendored ioBroker WebSocket client Verification Report

**Quick task goal:** Replace the vendored ioBroker WebSocket client (`src/lib/iobroker.socket.io.js`) with the published upstream client package (`@iobroker/ws`), while keeping our extra requirement: the ioBroker server address must have a configurable fallback (`FALLBACK_BROKER`), used automatically when the UI is not launched from ioBroker.admin with connection data in the link — because the SPA is meant to become a PWA that can also be started locally.

**Verified:** 2026-10-22T20:27:46Z
**Status:** human_needed
**Re-verification:** No — initial verification (no previous VERIFICATION.md in the task directory)
**Branch/commit under verification:** `quick/261022-up1-websocket-client` @ `30e3136` (3 commits on base `dafa71e`)

**Bottom line:** every automatable must-have holds, and the SUMMARY's numbers are reproduced exactly (399/399 unit, 46/46 package, lint 0, check 0, marker gate, address gate). The two truths that assert *runtime* behavior — the SPA actually speaking the protocol, and a locally started PWA actually reaching `ihome.0` — are present and wired but unexercised, because no test in this repo opens a socket and the executor had no browser. They are marked ⚠️ PRESENT_BEHAVIOR_UNVERIFIED and routed to the human checks H1/H2 the plan already deferred. **A human still has to confirm H1 and H2 before this branch is merged.**

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | The SPA speaks the ioBroker WebSocket protocol through the published client, and no hand-copied client remains in `src/` (unit contract test + marker gate on the built bundle + a human check against 192.168.178.9) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | **Static half VERIFIED:** `src/lib/iobroker.socket.io.js` is gone; `grep -rn "iobroker\.socket\.io" src/ eslint.config.mjs \| wc -l` → `0` (baseline 3); `test/` and `main.js` clean; the only remaining hits repo-wide are a stale `.playwright-mcp/console-*.log` from 2026-10-09. **Wiring VERIFIED:** `src/lib/ioBrokerConnect.svelte.js:3` `import "@iobroker/ws"` (side-effect), `:266` `ioBroker.socket = socket = globalThis.io.connect(url, roptions)`, `:269` `socket.connect(url, roptions)` on the reused-client path, `:13` JSDoc `import("@iobroker/ws").SocketClient` (the package declares that class in `build/esm/types.d.ts:40`). Contract test green: `src/lib/socket-client.test.ts > the package's entry point provides the client the SPA drives`. Marker gate green: `grep -rl "callbackTimeout" www/` → `www/index.html` (and the literal is absent from the deleted vendored copy — `git show dafa71e:src/lib/iobroker.socket.io.js \| grep -c callbackTimeout` → `0` — so the marker really does discriminate which client landed). **Runtime half unexercised:** no test opens a socket (the contract test passes a do-nothing `WebSocket` stub), so nothing proves the handshake/READY/state round-trip. See Human Verification H1. |
| 2 | With no connection data in the page and nothing stored in the app's own settings, the socket URL comes from one configured broker value instead of from the page's host (unit-tested precedence) | ✓ VERIFIED | `src/lib/socket-url.ts:14-27` `resolveSocketUrl` returns `env \|\| query \|\| socketUrlFromHostPort(configured ?? "") \|\| ws(s)://<hostname>:8081/socket.io`. Tests pass: *uses the configured fallback when nothing else is given* → `ws://192.168.178.9:8081/socket.io`; *?socket= wins over the configured fallback*; *VITE_SOCKET_URL wins over the configured fallback*; *falls back to the page host when nothing is configured* (incl. https → `wss`). This is a pure function with no state transition, so unit tests are sufficient evidence. |
| 3 | The built SPA opened from a non-broker origin (localhost) with the fallback set reaches the broker's namespace `ihome.0` (human-verified) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The path is present and wired end-to-end (`+layout.svelte:52` `buildUrl` → `ioBrokerStart({url})` → `ioBroker.connectOptions.url` → `ioBrokerConnect.svelte.js:240` destructure → `:266` `globalThis.io.connect(url, …)`), and the fallback slot is unit-tested. But the connection itself needs a browser and the live broker: plan check H1 was not run. The truth is *defined* as human-verified, so it cannot be VERIFIED on presence. See Human Verification H1. |
| 4 | The committed/published default keeps the fallback empty, so the shipped bundle carries no private address (unit test on the empty path + a count gate on the config file) | ✓ VERIFIED | `src/lib/broker-config.ts:16` `export const FALLBACK_BROKER = "";` and `grep -c 'FALLBACK_BROKER = ""' src/lib/broker-config.ts` → `1`. Empty-path unit test green (`socketUrlFromHostPort("")` → `""`; `resolveSocketUrl` with `configured: ""` → page host). Bundle gate green: `grep -rl "192\.168\.178\.9" www/ \| wc -l` → `0`. |
| 5 | When the page is served by the broker and no fallback is set, the resolved URL is still `ws(s)://<page-host>:8081/socket.io` — the four existing socket-url tests keep passing unchanged | ✓ VERIFIED | The four `defaultSocketUrl` cases are present verbatim at `src/lib/socket-url.test.ts:22-47` (page host on 8081; `wss` on https; `?socket=`; `VITE_SOCKET_URL`) and all pass. `git diff dafa71e..HEAD -- src/lib/socket-url.test.ts` adds the new blocks after them without touching the originals. |
| 6 | A locally started PWA resolves broker-relative icon paths against the same broker, not against localhost (unit test) | ✓ VERIFIED | `src/lib/utils/icon-url.ts:6,27-29` — stored Host:Port → `FALLBACK_BROKER` → `location.origin`, then `protocol//hostPort`. Test green: *iconBase uses the configured broker fallback when nothing is stored* (`vi.doMock("$lib/broker-config", "192.168.178.9:8082")` → `http://192.168.178.9:8082`). Data flow reaches rendering — see the Level-4 trace. |
| 7 | Both settings descriptions of an empty Host:Port name the configured fallback before the page host | ✓ VERIFIED | `src/routes/settings/+page.svelte:80-81` hint: *"Leave empty to use the configured broker fallback, or the host serving this page when no fallback is set (socket.io on port 8081)."*; `:101-104` card: `{ioBroker.namespace} via {storage.hostPort \|\| FALLBACK_BROKER \|\| "this host"}` with the import at `:3`. The `e.g. 192.168.1.10:8081` placeholder is kept as the plan directs. |

**Score:** 5/7 truths verified (2 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/lib/ioBrokerConnect.svelte.js` | Client created through the package's `io.connect` entry point; no vendored import | ✓ VERIFIED | Exists, substantive (17 211 B), wired (the only transport); `import "@iobroker/ws"` + `globalThis.io.connect(url, roptions)`; the old post-handler `socket.connect(url, {path, query})` is gone; `destroy()` retained on the recreate path (`:257-259`). |
| `src/lib/socket-client.test.ts` | Pins the adopted package's entry-point contract | ✓ VERIFIED | New (38 lines); asserts `io.connect` is a function and the socket exposes `emit/on/off/close/disconnect/destroy` with `connected === false`, then `destroy()`. Passes in 1 ms; uses a `Stub` `WebSocket` so no real socket opens. |
| `src/lib/broker-config.ts` | The single configured fallback (`host:port`), empty by default | ✓ VERIFIED | New (16 lines); `export const FALLBACK_BROKER = ""` at `:16`; doc comment states the purpose, the two suppressed sources (`?socket=` / `VITE_SOCKET_URL`, `__VISUAL__:hostPort`), the `ws://<value>/socket.io` shape, and the "must stay empty because `www/` is published" contract — without repeating the assignment literal (the count gate still proves something). |
| `src/lib/socket-url.ts` | `socketUrlFromHostPort` + `resolveSocketUrl` (one home for the URL rule and its precedence) | ✓ VERIFIED | Exists (39 lines); both functions exported and unit-tested; `defaultSocketUrl` is a thin reader of the page's own sources. Only one `ws://` construction site in `src/` outside tests (the doc comment in `broker-config.ts`); no competing derivation elsewhere. |
| `www/` | Rebuilt bundle carrying the adopted client (marker: `callbackTimeout`) | ✓ VERIFIED | `grep -rl "callbackTimeout" www/` → `www/index.html` (3 occurrences); `www/index.html` also carries the new settings copy (*"Leave empty to use the configured broker fallback"*) and no reference to the deleted file; committed in `30e3136`. `grep -rl "192\.168\.178\.9" www/ \| wc -l` → `0`. |
| gone: `src/lib/iobroker.socket.io.js` | Deleted | ✓ VERIFIED | Absent from the working tree; `git cat-file -e dafa71e:src/lib/iobroker.socket.io.js` confirms it existed at base (413 lines removed in `614c5ad`); its ESLint override block in `eslint.config.mjs` is gone while the `**/*.svelte.js` runes block above it is intact. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `src/routes/+layout.svelte` `buildUrl` | `socketUrlFromHostPort` | import from `$lib/socket-url`, called as `socketUrlFromHostPort(hostPort) \|\| defaultSocketUrl()` | ✓ WIRED | `+layout.svelte:11` import, `:51-53` the function, `:57` `url: buildUrl(storage.hostPort)`. The inline template string is gone — one home for the rule. |
| `src/lib/socket-url.ts` | `src/lib/broker-config.ts` | `import { FALLBACK_BROKER }` → `configured:` slot of `resolveSocketUrl` | ✓ WIRED | `socket-url.ts:1` import, `:35` `configured: FALLBACK_BROKER`. |
| `src/lib/utils/icon-url.ts` `iconBase` | `src/lib/broker-config.ts` | `import { FALLBACK_BROKER }` → `if (!hostPort) hostPort = FALLBACK_BROKER` | ✓ WIRED | `icon-url.ts:6` import, `:27` the fallback, `:28` the origin last resort. |
| `package.json` devDependencies | the bundle in `www/` | `@iobroker/ws@^3.1.3`, dev-only; bundled into the committed `www/` | ✓ WIRED | `package.json:41` devDependency; `dependencies` is still exactly `{"@iobroker/adapter-core": "^3.4.3"}` (one runtime dep). `package-lock.json:1407-1415` pins `3.1.3` with `"dev": true` and an integrity hash; the package's own `dependencies` is `{}`. |
| the deleted client had exactly one importer | `src/lib/ioBrokerConnect.svelte.js` | `git grep -n "iobroker\.socket\.io" dafa71e -- src/ eslint.config.mjs` | ✓ WIRED | Exactly three hits at base: the one import (`ioBrokerConnect.svelte.js:3`), one JSDoc type reference (`:13`), and the ESLint block (`eslint.config.mjs:133` — a config, not an importer). No other module ever imported it. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `src/routes/+layout.svelte` → `src/lib/ioBrokerConnect.svelte.js` | `connectOptions.url` | `buildUrl(storage.hostPort)` → `socketUrlFromHostPort` \|\| `defaultSocketUrl()` → `resolveSocketUrl` over `import.meta.env.VITE_SOCKET_URL` / `location.search` / `FALLBACK_BROKER` / `location` | Yes — resolved from the live page + the committed config, never a literal | ✓ FLOWING |
| `src/lib/components/common/Icon.svelte` `<img src>` | `iconSrc(value, owner)` | `iconBase()` → `localStorage["__VISUAL__:hostPort"]` → `FALLBACK_BROKER` → `location.origin` | Yes — real localStorage / location reads | ✓ FLOWING |
| `src/routes/settings/+page.svelte` card label | `storage.hostPort \|\| FALLBACK_BROKER \|\| "this host"` | the reactive settings store | Yes | ✓ FLOWING |

No value's chain ends in a static return, a hardcoded literal, or a mock on the production path. The only `Stub`/`doMock` in the phase are test doubles (`socket-client.test.ts`'s no-op `WebSocket`; `icon-url.test.ts`'s `vi.doMock` of the config), both correctly scoped to tests — and neither leaves a global behind (`socket.destroy()`, `vi.doUnmock` + `vi.resetModules`).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Whole unit suite | `npm run test:unit` | `Test Files 34 passed (34)` / `Tests 399 passed (399)` — matches the SUMMARY's 399 (was 391) | ✓ PASS |
| Adapter package smoke tests | `npm run test:package` | `46 passing (123ms)` — matches | ✓ PASS |
| Lint | `npm run lint` | exit 0 | ✓ PASS |
| Types | `npm run check` | `svelte-check found 0 errors and 0 warnings` | ✓ PASS |
| New tests by name | `npx vitest run src/lib/socket-client.test.ts src/lib/socket-url.test.ts src/lib/utils/icon-url.test.ts --reporter=verbose` | `Test Files 3 passed (3)` / `Tests 17 passed (17)`, including the contract test and all four unchanged `defaultSocketUrl` cases | ✓ PASS |
| Production build runs from current source | `npm run build` | exit 0, `www/` written | ✓ PASS |
| The committed bundle IS the current build (not stale, not H1-pinned) | `npm run build` then normalize only build nonces (`__sveltekit_*`, `bundle.<hash>.js`, the 13-digit version) and `diff` against the committed `www/` | **byte-for-byte identical** for `index.html` (420 207 chars both sides) and `service-worker.js`; only `www/_app/version.json` and the two nonce classes differ. Only `index.html`, `service-worker.js`, `version.json` differ at all | ✓ PASS |
| Adopted client is in the shipped bundle | `grep -rl "callbackTimeout" www/` | `www/index.html` (and `0` occurrences in the deleted copy at base, so the marker discriminates) | ✓ PASS |
| No installation-specific broker address in the shipped bundle | `grep -rl "192\.168\.178\.9" www/ \| wc -l` | `0` | ✓ PASS |
| No hand-copied client left in source | `grep -rn "iobroker\.socket\.io" src/ eslint.config.mjs \| wc -l` | `0` (baseline 3) | ✓ PASS |
| Committed default stays empty | `grep -c 'FALLBACK_BROKER = ""' src/lib/broker-config.ts` | `1` | ✓ PASS |

The build in the seventh row was run in place, its output compared, and `www/` then restored with `git checkout -- www/`; `git status --porcelain` was re-checked and shows nothing but the untracked `261022-up1-SUMMARY.md`. No repository state was left modified.

### Probe Execution

Not applicable — this phase declares no probes, and `find scripts -path '*/tests/probe-*.sh'` returns nothing. The PLAN's Task 3 `verify` blocks are test/build/grep/human-check gates, all of which are covered by the tables above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| UP1-R1 | `261022-up1-PLAN.md` | Replace the hand-vendored `src/lib/iobroker.socket.io.js` with a standard published package | ✓ SATISFIED (automated) / ⚠️ runtime unproven | File deleted, nothing in `src/` or `eslint.config.mjs` references it, `@iobroker/ws@3.1.3` is a devDependency with a pinned lockfile entry, the transport creates its client via `globalThis.io.connect`, the contract test and the bundle marker gate are green. The end-to-end proof is H1 (see Human Verification). |
| UP1-R2 | `261022-up1-PLAN.md` | The broker address gets a configurable fallback, used automatically when the UI is not launched with connection data | ✓ SATISFIED (automated) / ⚠️ runtime unproven | `FALLBACK_BROKER` (`host:port`, committed empty) is the one configured home; the tested precedence is `VITE_SOCKET_URL` → `?socket=` → configured → page host; both `+layout.svelte` and `icon-url.ts` read it; both settings descriptions name it first; the shipped bundle carries no address. The proof that a locally started PWA actually connects is H1. |

No orphaned requirements: `.planning/REQUIREMENTS.md` maps no ROADMAP id to this quick task — `UP1-R1`/`UP1-R2` are the two clauses of the task description, and the phase's only touch on the tracked backlog is the recorded in-place supersession of INSTALL-06's second clause (`REQUIREMENTS.md:45`, with the `engines.node` clause and the `| INSTALL-06 | Phase 2 | Pending |` row deliberately untouched).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | None | — | No `TBD`/`FIXME`/`XXX` (or `TODO`/`HACK`/`PLACEHOLDER`/`not yet implemented`) markers in any file this phase touched or created — so the debt-marker gate does not fire. No empty implementations, no hardcoded-empty values on the production path, no `console.log`-only bodies. `socket-client.test.ts`'s no-op `Stub.close()/send()` is a deliberate test double for the `WebSocket` option, not a stub of a required behavior (classification per the test-helper exemption); `<img onerror>` and the settings page's unchanged `e.g. 192.168.1.10:8081` placeholder are legitimate and pre-existing. |

One `ℹ️ Info`, outside this phase's scope: `.playwright-mcp/console-2026-10-09T23-32-54-002Z.log` still names the deleted file in stack traces. It is a captured browser console log from 2026-10-09, not source or config; nothing imports from it.

### Ordering Deviation — Assessed

The executor reported one deviation: Task 3's commit (`30e3136`) was made **before** H1/H2 instead of after, because it had no browser. The task asked whether that leaves the committed artifact in the state the plan requires. **It does.** The plan's content requirement for that commit is explicit — *"The commit must carry `www/` rebuilt with the empty fallback (H2's restore-rebuild), never H1's pinned bundle"* — and three independent checks confirm it:

1. `grep -rl "192\.168\.178\.9" www/ | wc -l` → `0`, so H1's pinned bundle was not committed.
2. `FALLBACK_BROKER = ""` in the committed source, and the committed `www/` is byte-for-byte identical (modulo build nonces) to a fresh `npm run build` from that source — so no intermediate or stale build was committed either.
3. The committed bundle carries the post-Task-2 settings copy and the `callbackTimeout` marker, and no reference to the deleted file.

What the deviation *does* cost is the plan's process ordering: the branch now carries a commit whose real-broker behavior is unproven. If H1/H2 fail, the remedy is a follow-up commit on the branch (or the abandonment recipe the plan and handoff record), not "don't commit". This is a process deviation with no artifact defect, so it is not a gap — but it is why the verdict is `human_needed` rather than `passed`. Note also that running H1 dirties `src/lib/broker-config.ts` and `www/`; a human must restore them (Human Verification item 3) so the tree returns to `30e3136`.

### Human Verification Required

The plan deferred H1/H2/H3 in Task 3's `<human-check>` block, and the executor could not run them. They are harvested here in full; H1 and H2 are the only remaining obstacles to merging.

#### 1. H1 — the fallback path (proves UP1-R1 and UP1-R2 in one pass, and is the only evidence for the two ⚠️ truths)

**Test:** Set `FALLBACK_BROKER = "192.168.178.9:8081"` in `src/lib/broker-config.ts`, then `npm run build && npm run preview`, and open `http://localhost:4173/ihome/` (the base path from `vite.config.mjs`; use the URL preview prints if it differs). Confirm no `VITE_SOCKET_URL` in the shell or `.env.development.local` masks the fallback — the page host is `localhost`, so the fallback is the only way this can connect. Hard-reload if the page looks stale (a production build registers the service worker on localhost).
**Expected:** The connection footer reports connected for namespace `ihome.0`; tiles render live values; device icons render (this also exercises the icon base); toggling a control changes the broker state; the console shows no `Failed to connect to Socket.IO server` and no `No READY flag received in 3 seconds`.
**Why human:** Requires a browser and the live broker at `192.168.178.9` (js-controller 7.2.5, web 9.1.16). No test in the repo opens a socket — the contract test stubs `WebSocket` deliberately — so nothing automated can observe the handshake, the READY flag, or a state round-trip.

#### 2. H2 — the everyday broker-served path

**Test:** Set `FALLBACK_BROKER` back to `""`, run `npm run build` (so the committed bundle stays unpinned), `npm run deploy:www` with `IOBROKER_MCP` as usual, then open `http://192.168.178.9:8082/ihome/index.html`. Optional: `npm run test:integration` against the live controller.
**Expected:** Connected, live tiles, an edit persists to the broker.
**Why human:** Confirms the swap did not break the origin the app actually ships to; needs the live web adapter and a browser.

#### 3. Restore after H1

**Test:** Once H1 is done, restore the tree — `git checkout -- src/lib/broker-config.ts www/` (or an equivalent), then `git status --porcelain`.
**Expected:** Nothing shows but the untracked `261022-up1-SUMMARY.md`. The committed bundle is already the empty-fallback build; H1 deliberately dirties both files, and leaving the pinned address in `www/` would put a private address back into the published tarball (T-UP1-03).
**Why human:** Only the human who ran H1 knows whether they restored it.

#### 4. If either check fails

**Test:** `git switch main && git branch -D quick/261022-up1-websocket-client`.
**Expected:** The previous state returns; nothing outside this branch was touched.
**Why human:** This is the plan's abandonment recipe (H3) — decide it with the branch owner. Tells it failed by: a footer stuck on "not connected", console `Failed to connect to Socket.IO server` / `No READY flag received in 3 seconds`, an empty marker gate, or the contract test failing.

### Gaps Summary

**No gaps.** Every automated must-have is met and every SUMMARY claim I could re-run reproduced exactly: `src/lib/iobroker.socket.io.js` is deleted with zero remaining references in `src/` or `eslint.config.mjs`; `@iobroker/ws@3.1.3` is a devDependency with the runtime dependency count still at one; `FALLBACK_BROKER` is the single configured home, committed empty, read by both the socket URL and the icon base, with the tested precedence `VITE_SOCKET_URL` → `?socket=` → configured → page host; the four pre-existing socket-url cases pass unchanged; both settings descriptions name the fallback first; and `www/` is committed carrying the adopted client and no installation-specific address — verified not merely present but *reproducible*, since a fresh build matches the committed bundle byte-for-byte once the build nonces are normalized.

What remains is exactly what the plan said could not be automated: **a human has to run H1 and H2 against the real broker.** Two truths assert runtime behavior that nothing in this repo exercises — that the SPA actually completes the ioBroker WebSocket handshake through the adopted client, and that a PWA opened from `localhost` with the fallback pinned actually reaches `ihome.0`. Presence, wiring, a green contract test and a correct bundle are necessary but not sufficient for those, so they are recorded as behavior-unverified rather than counted as verified (5/7). That is the whole reason the status is `human_needed` and not `passed`.

---

_Verified: 2026-10-22T20:27:46Z_
_Verifier: the agent (gsd-verifier)_
