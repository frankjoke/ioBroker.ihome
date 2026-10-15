# Handoff — iHome display: OPEN double-toggle, and where the branch stands

**Date:** 2026-10-16 (written 2026-10-15 late, after the user stopped for the night)
**Project:** `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`
**Branch:** `feature/ihome-display` — 27 commits, cut from `main` @ `af3661c`, **not merged, no remote**
**Read first if you need the full history:** `docs/progress/handoff-2026-10-15-iobroker-visual-adapter.md`
(this file is only the *current* state + the open bug; that one has the whole session, the 45 rulings
and the reviewer's findings)

---

## 1. THE OPEN BUG — one press sometimes toggles a switch twice

**Symptom (user's words):** pressing `ON` or the icon on a switch sometimes toggles twice (the device
ends where it started, or moves two steps). Intermittent — "still happens some time".

### What the code provably does (verified today, with evidence)

- **The display is broker-only.** Nothing paints a write's outcome locally:
  - the vendored client has **no `setState`** of its own (`grep -c setState src/lib/iobroker.socket.io.js` → 0),
    so our write only *emits* to the broker;
  - the only writers of the live state cache are the socket's `stateChange` handler
    (`src/lib/ioBrokerConnect.svelte.js:269`) and `getState` (line 443);
  - no component assigns into that cache (grep for `states.update|states.set` returns only those two).
- **One write path:** `writeControl()` in `src/lib/utils/control-write.ts`, called by `Tile.togglePrimary`
  (`Tile.svelte`) and by `ControlWidget.write` (the modal + slider/switch widgets).
- **A single press produced a single write** when measured (sampled the broker's `ts` across one click).

### Fixed today (all committed)

1. **Stale live values after a socket blip** — the most likely cause of "sometimes". `loadUsedStates()`
   skipped ids it had already loaded, so after a disconnect (a `CLOSE_ABNORMAL` was seen in the console
   this session) the cache kept pre-blip values forever; a press then writes *relative to a value that was
   never true*. `reloadUsedStates()` (`src/lib/states.svelte.js`) now clears the set and re-reads
   everything from the broker on every (re)connect (called from `+layout.svelte`'s connect `$effect`).
2. **Two events for one press** — `writeControl` now refuses a toggle while an earlier one is
   unconfirmed: it allows the next press as soon as the live value equals what we wrote, with a 3 s
   ceiling. Sliders pass no lock (every step of a drag must land). Tests in
   `src/lib/utils/control-write.test.ts` (4 cases: lock, confirmation shortcut, ceiling, sliders,
   unwritable control).

**Verified live** on `Brunnen`: two presses 250 ms apart flipped it **exactly once**, app in sync; the
state was restored afterwards. **Caveat to tell the user:** by design a *deliberate* second press within
a few hundred ms is now **refused** — that is the guard doing its job; the ceiling releases after 3 s.

### Also ruled out today

Optimistic local painting · a duplicated handler in the tile · the pill and icon double-binding ·
the touch long-press path (touch-only, and it swallows the click it produced) · `applyWrite`/transform
(the affected controls have no transform).

### Do tomorrow, in this order (cheapest decisive first)

1. **Compare against iqontrol** (`192.168.178.9:8082/iqontrol`): press the same device the same way.
   If it doubles there too, it is the device/adapter (hm-rpc/hm-rega alias semantics), not our UI.
   This is one minute and settles most of it.
   **The user's observation (2026-10-15, late): iQontrol also shows the change only ~1 s AFTER the
   click** — it sends `setState` and paints only when the updated state arrives, i.e. no optimistic
   paint, same rule this display follows. Two consequences:
   - the comparison must be judged **with that delay in mind** (press once, wait ≥2 s before
     concluding nothing happened);
   - a ~1 s wait with no feedback is itself an invitation to press again — which is a *second write*
     from a second press, not a double. This makes "user pressed twice because nothing seemed to
     happen" a strong alternative explanation for the symptom, alongside the momentary-button case.
   - ~1 s echo latency also justifies the 3 s ceiling in the guard (a shorter timer would have been
     extended by the slow adapter anyway).

   **Candidate follow-up (if that is the explanation): give feedback without painting the value.**
   While a toggle write is unconfirmed, show that the press registered — e.g. a subtle pending state on
   the value/icon (reduced opacity or a small dot) that clears when the broker's value arrives. It keeps
   the display honest (never shows an unconfirmed value) while removing the "nothing happened, press
   again" reflex. The pending map in `writeControl` already knows exactly this state and can expose it
   (`isPending(id)`), so the UI change is small.
2. **Instrument writes and changes.** Add a temporary `?debug=` flag (or `console.log`):
   `[write] <id> <val> <at>` in `writeControl`, and `[change] <id> <val> <at>` in the `stateChange`
   handler (`ioBrokerConnect.svelte.js:266`). Press once and read the console:
   - **1 write + 2 changes** → the broker/adapter produces the second change: the device is momentary,
     or the adapter reports a *different* value than requested (we write boolean `true`, it reports
     `1`/`"true"` → the tile flips again). Not our UI.
   - **2 writes** → a second DOM activation reached the handler. Log
     `event.type`, `event.detail`, `event.isTrusted`, `pointerType` and `timeStamp` from the pill/icon
     handler to identify it (candidates: a touch double-tap ≥3 s apart, a synthesised click after
     `pointerup`, or an assistive/OS-level repeat).
3. **Check the device's semantics.** Confirmed today: `alias.0.Keller.AbstellraumLicht.SET` is
   **momentary** (writing `true` leaves it `false`), so a *Light* tile on it can never show a stable
   state and every press looks like a double toggle. That device wants type **`Button`** in `#/devices`.
   Check whether the "other switches" the user mentions are momentary too (same test: read the state,
   write `true`, read again).
4. **The `ts` stamp we send.** `ioBrokerConnect.setState` wraps a plain value as
   `{ val, ts: Date.now(), from: namespace }` (`src/lib/ioBrokerConnect.svelte.js:502`). Sending `from`
   + `ts` may make the broker/adapter treat it as already-acknowledged, which can change how the real
   device's report arrives (a visible extra flip). Experiment on **one** device: emit
   `{ val, ack: false }` instead and watch the write/change log from step 2. Careful: this brushes
   against ack semantics and the adapter may re-report asynchronously.
5. Only if step 2 shows **2 writes**: the durable fix is to make the activation unambiguous — e.g.
   drive toggles from `pointerup` only (never `click`), or dedupe by `event.timeStamp` per pointer id,
   rather than relying on the value guard.

---

## 2. Where the branch stands

- `npm test` **249 passed (21 files)**, `npm run check` **0/0**, `npm run lint` clean,
  `npm run build` writes `www/`. Everything below is committed on `feature/ihome-display`.
- Display: `/` and `#/p/<id>`, slim bar with page tabs + room/function/favorite chips, module grid,
  tiles with slots, badges, modal, Ctrl/Cmd+click → that device's config (`sessionStorage` handoff).
- Data: `0_userdata.0.Test.AiHome.pageList` + `...templateList`; devices' `functions`/`favorites`
  backfilled once from the broker's enum membership (channel-aware walk).
- Presets: 11 types, half-width modules (`w` counts half-modules), per-breakpoint clamps, `minmax(row, auto)`
  so rows grow instead of clipping.
- Readouts: `options.pick` hints (`temperature`/`humidity`/`power`/`energy`/`battery`) on both value
  slots and badges; label fallback; exact unit match.
- Typography: main value 0.90rem/700, unit 0.72rem/400 (−20%), secondary 0.84rem/400, its unit 0.67rem.
- Badges: four corners, 4 px outside the edge, corner = meaning (`ago` bottom-left, `battery`/`alarm`/
  `offline` top-right, readings top-left), band reserved so they never cover a value.

### Open items (unchanged, in rough priority)

1. **The double-toggle above** — the only *bug*.
2. **Phase 4 editors** (`/pages`, `/templates`, per-device overrides) — the biggest remaining piece, and
   the one that would stop these "can you make the tile look like X" iterations needing code changes.
3. `w: 2` for two-value thermometers (values currently wrap to two lines at the 60% width) — one number
   per preset in `src/lib/config/presets.ts`.
4. `energy` hint defined but unused; `Brunnen.Verbrauch` (Wh, 49376) is the natural first user.
5. Duplicate tile titles after suffix stripping (`Keller` ×2, `Garten-Pool` ×2) — the device form's
   **Tile title** field is the lever; a "strip only if unique in the group" rule is a small change.
6. Momentary-button devices mis-typed as Light (see 1.3).
7. Deferred minor from the reviewer: presets and their nested objects stay mutable.
8. Earlier still-open items from the 2026-10-11 handoff are listed in the 2026-10-15 handoff.

---

## 3. Environment

- Windows, bash. Scratch dir: `C:\Users\franz\AppData\Local\Temp\opencode`.
- **The user's dev server was NOT running** this session; mine (port 5174) is stopped. Start theirs with
  `npm run dev`. The app needs the broker host once, **as JSON**:
  `localStorage["__VISUAL__:hostPort"] = "\"192.168.178.9:8081\""` (a raw string breaks the parser).
- ioBroker host `192.168.178.9`, admin 8081, `web.0` 8082. The ioBroker MCP was used read-only, plus one
  delete of a `pageList` my own smoke run had created and one toggle test on `Brunnen` (restored to the
  state it was found in).
- Keep `cwd` at the repo root for `svelte-check`/`eslint`: a generated `.svelte-kit/` **inside** `src/`
  is eslint-ignored only at the root and otherwise throws ~300 phantom lint errors.
- State of `Brunnen`: left **OFF** (`alias.0.WZ.Brunnen.SET = false`) — it was ON when testing started and
  my two-press test plus restore left it there; flip it if that matters.
