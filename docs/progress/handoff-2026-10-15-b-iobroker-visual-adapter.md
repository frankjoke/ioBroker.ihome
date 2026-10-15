# Handoff — iHome: the Brunnen double-toggle (device-side), the rename, and how ioBroker serves the SPA

**Date:** 2026-10-15 (session 2, evening — `-b` suffix; the `2026-10-16` file was the previous
session writing late on the 15th)
**Project:** `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`
**Branch:** `feature/ihome-display` — **no remote yet**, and this session's work is **uncommitted**
**Read first for the older history:** `docs/progress/handoff-2026-10-16-iobroker-visual-adapter.md`
(the open double-toggle) and `handoff-2026-10-15-iobroker-visual-adapter.md` (the display build)

Verified at the end of this session: `npm test` **249 passed (21 files)**, `npm run check` **0/0**,
`npm run build` writes `www/`, `npm run lint` → **5 pre-existing** errors only (`Tile.svelte` mutable
`Set`, `pages.js` `sessionStorage` ×3, unused import in `control-write.test.ts`).

---

## 1. The double-toggle: the app is clean, the plug reverses itself

### The instrument (uncommitted, still installed)

Grep `ihome-dbg` to find and delete all of it: `src/lib/utils/dbg.ts` (`logPointer`), its two callers
(`slots/IconSlot.svelte`, `slots/ValueSlot.svelte`), the accept/refuse + `down`/`up`/`click tile-capture`
lines in `Tile.svelte`, the toggle-only line in `slots/ControlWidget.svelte`, and the change line in
`ioBrokerConnect.svelte.js` (`stateChange`).

### What the user's log proved

- One press = **one click → one write**, twice in a row, guard refusing nothing. No second activation.
- **The real anomaly:** after press 1 (OFF) the plug wrote **`true` back 745 ms later** —
  `alias.0.WZ.Brunnen.SET` *and* `shelly.1.shellyplugsg3#28372f2f3768#1.Relay0.Switch`, both
  `ack=true`, ts `16:46:17.708` — with a genuine `ELECTRIC_POWER = 0` at `16:46:17.189` in between
  (so it really was off for ~0.5 s) and 16.7 W at the next minute report. The relay ends **ON** after
  a press that asked for OFF. That is "one press, toggles twice" — device side.
- Press 2 (ON) was then physically a no-op, but the tile still flickered `true → false → true` from
  two acked reports (`ack=true false` at `:881`, `ack=true true` at `:942`).

### Ruled out (all read-only checks)

Zigbee wall button (`$Taster('BrunnenTaster', 'zigbee.0.8cf681fffebbd907.recall_3',
'zigbee.0.b4e3f9fffeef8ae0.recall_1')` at `script.js.Active.EM-LichtSystem:644`) — last pressed hours
before; the *duplicate* pump machine in `script.js.scripts.EM_LichtSystem:581` — that script is
`enabled: false`; `scenes.0` — no scenes; `energiefluss.0` — no Brunnen anywhere in its config (it is
a visualization adapter; its `customN_plugged` entries only write its own info states); the plug's own
timers (`Relay0.AutoTimerOn/Off = false`, `InitialState = "off"`, `source = MQTT`).

### Still open — who wrote `true` at 16:46:17.708

The host log only retains from `16:46:29` (javascript.0 debug floods it) and the aliases have **no
history configured** (`history_query` returns empty), so the writer left no trace. Decisive next step:
**enable history on `alias.0.WZ.Brunnen.SET`** (one reversible line in its `common.custom`, `history.0`
already runs — the sparklines use it) and reproduce. Only remaining in-ioBroker suspect: **Alexa**
(two `alexa2.0.Smart-Home-Devices…Brunnen` channels exist).

A live side experiment, now that writes are no longer stamped `admin.0`: if any script filters on
`from`, the double rate should change. Worth a few presses before/after.

**Brunnen is left ON** (the reversal put it there; power 16.7 W).

---

## 2. Renamed to iHome (identifiers `ihome`, brand `iHome`)

Adapter names must be lowercase — npm forbids uppercase in new package names, and the checker wants
`io-package.json` `common.name` == package name minus `iobroker.`. The brand lives in the Name fields.

| where | now |
|---|---|
| npm package | `iobroker.ihome` |
| `io-package.json` `common.name` | `ihome` → instance namespace `ihome.0` |
| brand | `iHome` in `titleLang`, `adminTab.name`, PWA manifest, page titles, README |
| `main.js` | `name: "ihome"`, class `IHome`, log text |
| admin UI | field ids `ihome.*`, config object `ihome.0.config` |
| production base | `svelte.config.js`: `/ihome` (was `/visual-interface`) |
| author | `Frank Joke <frankjoke@hotmail.com>` (`package.json` author, `io-package.json` authors) |
| LICENSE | MIT text, `Copyright (c) 2026 Frank Joke` (scaffold said `2024 Commander`; first commit is 2026-10-10) |
| URLs | all `yourusername` → `frankjoke`; repo `frankjoke/ioBroker.ihome` **not created yet** (name free; the GitHub MCP here is authenticated as `frankjoke`) |

Also: **`admin/ihome.png` created** (copy of `static/icon-512.png`) — `common.icon` pointed at a file
that never existed. And the **Switch preset now glows green** (`src/lib/config/presets.ts`:
`{ when: "truthy(power)", color: "var(--success-color)", glow: true }`); Light stays amber.

Deliberately untouched: the **working folder** `iobroker-visual-adapter` and AGENTS.md's handoff
naming; the historical docs; the other 9 languages in `news`/`desc` (`npm run translate` regenerates
them from English); and `main.js:34-37`, whose `this.log.info("config width: ${…}")` are missing their
backticks (pre-existing, flagged not fixed).

---

## 3. `from` / namespace, and ack

- `DEFAULT_NAMESPACE = "iHome"` is exported from `ioBrokerConnect.svelte.js` and used for the client
  default and the connect-option default. `+layout.svelte` maps the **old** stored value (`admin.0`) and
  an empty field to it — necessary because `createReactiveStorage` *persists* its init value, so every
  browser that ever loaded the app has `__VISUAL__:namespace = "admin.0"` on disk.
- `admin.0` bought **no rights**: rights come from the connection's authenticated user, and we send no
  token (anonymous). Log evidence: our writes came back as `ack=false from=admin.0`, while real
  adapter writes/acks read `system.adapter.<name>.<instance>` — that is the form to use once `ihome`
  is installed.
- **ack stays `false`** for now; per-control ack config comes with the adapter work. Latent bug to fix
  then: `setState` double-wraps a caller-supplied `{ val, ack }` (its guard only recognises `from`).

---

## 4. How the SPA gets served by ioBroker (spike — answer: no code changes; blocker: transport)

**Proven with `npm run preview` + Playwright** (server stopped, screenshot deleted): served from a
subpath the app is fully fine — `base: /ihome` is correct, **zero failed requests**, the service worker
resolves at `/ihome/service-worker.js` (the whole app is inlined in `index.html`, 358 KB, 11 files),
the socket connects, and the real pages render: Bad 12.7 °C/52.7 %, Garten 10.5 °C/80 %, Keller ×2,
Terrasse 7 °C/65 %, **Brunnen OFF · 0 W · 23m**, AZFranz printers. 0 errors.

**The serving model, verified against the live broker:**

- `/iqontrol/` is served from the adapter's `www/` **on the broker's disk** → needs the adapter
  installed and its instance running.
- `<namespace>/<path>` serves **file-DB** content (`0_userdata.0` probe file answered; `/material.0/`
  gave a directory listing). But writes into `ihome.0` are refused — *"ihome.0 is not an object of type
  meta"* — **even after** creating the meta object exactly like `material.0`'s; the guard is the
  installed **instance**, not the namespace object.
- web.0 speaks socket.io on 8082, so a same-origin served app connects with no config.

**Blocker: no write access to the host.** ioBroker is a Raspberry Pi at `192.168.178.9`; SSH is
password-only (no key here), no local Docker, no share. And my ioBroker file tools pass content
*through the model*, so 358 KB ≈ 120k tokens is not a transport. Installations/uploads run as the
`iobroker` system user anyway, so **the deploy belongs to the adapter step** — the user's call, deferred.

**Left the broker clean:** the probe files and the `ihome.0` meta object were deleted (verified null).

**Side finding to fix:** `0_userdata.0.Test.AiHome.templateList` does not exist in the broker (five
`getState: … not found` warnings) although `pageList` does — its create-if-missing path is not firing.
Presets still render, so it is benign today.

---

## 5. Environment

- Windows, bash. MCPs available: `iobroker` (read + file/object writes), `github` (authenticated as
  `frankjoke`), `playwright` (browser, screenshots, network/console).
- Point the app at the broker once, as JSON: `localStorage["__VISUAL__:hostPort"] = "\"192.168.178.9:8081\""`.
  With the namespace change the stored `__VISUAL__:namespace = "admin.0"` now counts as unset.
- ioBroker `192.168.178.9`: admin 8081, `web.0` 8082 (auth **off**, serves socket.io, serves DB files
  at `/<namespace>/<path>`).
- Keep `cwd` at the repo root for `svelte-check`/`eslint` (a `.svelte-kit/` inside `src/` produces
  phantom lint errors).

---

## 6. Next session, in order

1. One more Brunnen press with the tracing on. If it is one write plus a reversal change, enable history
   on that state (and check Alexa routines) — then **delete the `[ihome-dbg]` instrument**.
2. Commit, as **two** commits: the rename/identity (with the green switch glow), and the tracing if it
   survives step 1.
3. Create `frankjoke/ioBroker.ihome`, add the remote, push `feature/ihome-display`.
4. Adapter packaging: jsonConfig instead of the legacy `admin/index.html`, a proper `main.js`
   (lifecycle, `this.log`, `adapter-core`, `setObjectNotExistsAsync`), tests via `@iobroker/testing`,
   the Adapter Checker — then install on the Pi and `iobroker upload ihome`. Revisit at that point:
   `svelte.config.js` base (likely `/ihome.0`) and `DEFAULT_NAMESPACE` → `system.adapter.ihome.0`.
5. Still open from before (unchanged): phase-4 editors (`/pages`, `/templates`), `w: 2` for two-value
   thermometers, unused `energy` hint, duplicate tile titles, momentary-button devices mis-typed as
   Light, and the missing `templateList` document.
