# Roadmap: iHome

## Milestones

- 🚧 **v1.0 Adapter on a real broker** - Phases 1-5 (in progress)

## Overview

The 11-spec design series (2026-10-09 → 2026-10-21) has landed: the display, the layout sheet as a
mode of the display, the tile editor with its per-slot descriptors, device icons from the broker
hierarchy, and an installable adapter (0.0.1 → 0.0.10) that owns four `ihome.0.config.*` documents.
This roadmap covers what remains before the adapter can be trusted and shipped as a normal ioBroker
adapter: proving the guards that protect an operator's document, verifying the install path on a
clean broker, finishing history/charts at the scale the dashboard actually uses them, building the
editor capabilities the specs explicitly deferred, and walking the release path onto npm and
`ioBroker.repositories`. Every phase is measured by what an operator can do with the installed
adapter, not by documentation.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Document safety on a real broker** - The guards that keep an operator's document from being lost are proven, not just written
- [ ] **Phase 2: Clean-broker install and lifecycle** - The packaged adapter installs on a broker that has never seen iHome and serves a rendered dashboard
- [ ] **Phase 3: History and charts at operator scale** - History behind a reading shows on the tile and the detail page, fetched once per state
- [ ] **Phase 4: The editor's deferred capabilities** - Cross-device slots, a template library, and visible tile position
- [ ] **Phase 5: Release path** - iHome installs from the ioBroker admin's adapter list, not a hand-built tarball

## Phase Details

### Phase 1: Document safety on a real broker
**Goal**: An operator's dashboard document cannot be lost or silently overwritten — not by a bad read, a dropped socket, a second tab, or the adapter's migration.
**Depends on**: Nothing (first phase)
**Requirements**: PERSIST-01, PERSIST-02, PERSIST-03, PERSIST-04, PERSIST-05
**Success Criteria** (what must be TRUE):
  1. With `ihome.0.config.pageList` deleted or corrupted on the broker, loading the dashboard shows the seeded display while the state stays exactly as it was — no write reaches the broker
  2. Stopping the broker mid-edit shows "not saved" in the editor, and the edit lands after the socket reconnects; the stored document equals the last successful save, never an empty one
  3. Starting `ihome.0` against a broker holding only legacy `0_userdata.0.Test.AiHome.*` documents copies the real documents into `config.*` and leaves the legacy states intact
  4. A regression in a guarded write path or in the migration helper fails `npm test` instead of reaching the broker
  5. A build/pack run reports it when the committed `www/` no longer matches a fresh build of `src/`
**Plans:** 5 plans

Plans:
- [ ] 01-01-PLAN.md — Prove the pageList guard end to end and make a dropped edit survive reconnect (PERSIST-01, PERSIST-02, PERSIST-03)
- [ ] 01-02-PLAN.md — Extract the adapter's placeholder/legacy-copy decision into a tested pure helper and ship it (PERSIST-04)
- [ ] 01-03-PLAN.md — Prove propagation and the write path for templateList, deviceList and formulaList (PERSIST-03)
- [ ] 01-04-PLAN.md — Add the `www/` build-drift guard behind a deterministic `version.name` (PERSIST-05)
- [ ] 01-05-PLAN.md — Record the accepted concurrency limit and observe the three broker criteria (D-03)

### Phase 2: Clean-broker install and lifecycle
**Goal**: An operator can install the packaged adapter on a broker that has never seen iHome, start the instance once, and open a dashboard that renders the broker's devices.
**Depends on**: Phase 1
**Requirements**: INSTALL-01, INSTALL-02, INSTALL-03, INSTALL-04, INSTALL-05, INSTALL-06
**Success Criteria** (what must be TRUE):
  1. Installing `iobroker.ihome-<version>.tgz` from the admin install dialog and starting `ihome.0` once creates the four `config.*` states and the instance exits without an error
  2. `/ihome/index.html` on that clean broker renders the seeded pages, and the admin link card opens the same page
  3. The adapter object's version in admin equals the shipped package version — no stale 0.0.x is left behind
  4. `npm run deploy:www` against the running broker serves exactly the locally built SPA (`_app/version.json` parity) without reinstalling the adapter
  5. CI's check + lint job and the adapter-test job are green on the pushed commit
**Plans**: TBD

### Phase 3: History and charts at operator scale
**Goal**: An operator can put history behind a reading and see it on the tile and in the detail page, and the dashboard fetches each series once no matter how many tiles show it.
**Depends on**: Phase 2
**Requirements**: HIST-01, HIST-02, HIST-03, HIST-04
**Success Criteria** (what must be TRUE):
  1. Configuring history on a control in the device editor and enabling the sparkline on a value slot draws the chart on the tile and in the detail row for a history-logged state
  2. Two tiles charting the same state produce one `getHistory` request for that state, and both draw from the same cached series
  3. A control with many history entries can be collapsed to one line in the detail page and expanded again
  4. Clicking a tile's sparkline opens a larger chart of the same series
  5. A tile whose source carries no history can gain a chart through that workflow alone (configure history, enable the toggle) — no hand-editing of the document
**Plans**: TBD
**UI hint**: yes

### Phase 4: The editor's deferred capabilities
**Goal**: An operator can build a tile that reads another device, manage the template library outside a tile, and see where a tile sits in its section.
**Depends on**: Phase 2
**Requirements**: EDIT-01, EDIT-02, EDIT-03, EDIT-04
**Success Criteria** (what must be TRUE):
  1. A slot can be pointed at another device's control and the tile renders that device's live value, with the slot row naming the source device
  2. The template list shows the user templates; renaming or deleting one leaves every tile rendering — a deleted template falls back to the chain, never a blank tile
  3. The sheet's tile line shows the tile's position (e.g. `3 / 7`) and moving with ↑/↓ updates it
  4. The tile editor's field groups start folded to one line and expand on demand
**Plans**: TBD
**UI hint**: yes

### Phase 5: Release path
**Goal**: An operator can install iHome from the ioBroker admin's adapter list instead of a hand-built tarball.
**Depends on**: Phases 1-4
**Requirements**: REL-01, REL-02
**Success Criteria** (what must be TRUE):
  1. `npm run release` bumps the version, writes the changelog and tags the commit, and the tagged build passes `npm test`
  2. `iobroker.ihome` is published to npm and the adapter appears in the admin's adapter list
  3. Installing from that list on a clean broker reaches a rendered dashboard with no manual `www/` upload and no hand-built tarball
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Document safety on a real broker | 0/5 | Planned | - |
| 2. Clean-broker install and lifecycle | TBD | Not started | - |
| 3. History and charts at operator scale | TBD | Not started | - |
| 4. The editor's deferred capabilities | TBD | Not started | - |
| 5. Release path | TBD | Not started | - |
