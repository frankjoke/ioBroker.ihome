---
phase: "1"
slug: "document-safety-on-a-real-broker"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-22"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (`environment: "node"`, `expect.requireAssertions: true`) for unit; mocha 12.0.3 + `@iobroker/testing` 6.3.1 for package/integration |
| **Config file** | `vite.config.mjs` `test` block (lines 51-57) — no separate `vitest.config.*`, no setup files, no globals |
| **Quick run command** | `npx vitest run src/lib/stores/pages.svelte.test.ts` |
| **Full suite command** | `npm test` (`test:unit` → `test:package` → `test:integration`) |
| **Estimated runtime** | ~2 s unit · ~3 s unit+package · full `npm test` includes the mocha integration leg (needs a real js-controller) |

**Verified baseline (2026-10-22):** `npx vitest run` → 33 files / 391 tests passed · `npm run test:package` → 46 passing.

---

## Sampling Rate

- **After every task commit:** `npm run test:unit` (≈2 s), plus `npx vitest run <the file you touched>` while iterating
- **After every plan wave:** `npm run test:unit && npm run test:package` (≈3 s) and `npm run lint && npm run check`
- **Before `/gsd-verify-work`:** Full suite green (`npm test`), plus the three manual broker observations below
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-1-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ❌ W0 | ⬜ pending |

*Seeded by plan-phase — the rows are filled in from the plan task lists during execution and finalized by
`validate-phase` (§6). Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/stores/pages.svelte.test.ts` — PERSIST-01, PERSIST-02, PERSIST-03 (pageList); carries the harness every other store test copies
- [ ] `src/lib/stores/templates.svelte.test.ts` — PERSIST-03 (templateList)
- [ ] `src/lib/formulas.svelte.test.ts` — PERSIST-03 (formulaList)
- [ ] `src/lib/registry.svelte.test.ts` — PERSIST-03 (deviceList)
- [ ] `lib/adapter-migrate.js` (+ a `package.json` `files` entry) — the PERSIST-04 helper the CJS adapter can require
- [ ] `src/lib/config/adapter-migrate.test.ts` — PERSIST-04 test
- [ ] `scripts/www-drift.mjs` (+ the shared fingerprint module) — PERSIST-05 check
- [ ] `vite.config.mjs` — deterministic `version.name` (the drift guard's precondition)
- [ ] `package.json` — the `prebuild` hook (and `files` if `lib/` is added)
- [ ] No framework install needed: Vitest 4.1.11 and mocha 12.0.3 are present; `expect.requireAssertions` is already on, so every new test must contain at least one assertion

*(No shared fixtures module is needed — the repo's convention is a top-of-file factory per test file.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Delete or corrupt `ihome.0.config.pageList` on the broker, then load the dashboard | PERSIST-01 | Needs a real socket + browser; no in-repo automation path | Open the Objects tab, note `pageList`'s value, delete/corrupt it, load the dashboard, confirm the seeded display renders and the state is byte-identical afterwards |
| Stop the broker mid-edit | PERSIST-02 | Needs a real socket drop | Edit a tile in the layout sheet, stop the broker, confirm "not saved" shows, restart, confirm the edit lands and the stored document equals the last successful save (never empty) |
| Start `ihome.0` against a broker holding only legacy `0_userdata.0.Test.AiHome.*` documents | PERSIST-04 | Needs an adapter start (`Instances → play`) | `npm run test:integration` covers the start, not the copy outcome — inspect `ihome.0.config.*` after the run and confirm the legacy states are intact |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 3s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
