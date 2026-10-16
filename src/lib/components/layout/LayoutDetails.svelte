<script lang="ts">
  import { onMount } from "svelte";
  import { backgroundCss } from "$lib/config/appearance";
  import {
    patchPage,
    patchPlacement,
    patchSection,
    type LayoutSelection,
  } from "$lib/config/layout-ops";
  import {
    resolveSection,
    toFilterable,
    type FilterableDevice,
  } from "$lib/config/pages-ops";
  import {
    BREAKPOINTS,
    breakpointFor,
    type TileSpan,
  } from "$lib/config/size-ops";
  import { effectiveSpan } from "$lib/config/template-ops";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import GroupSection from "$lib/components/display/GroupSection.svelte";
  import Tile from "$lib/components/display/Tile.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import IconPicker from "$lib/components/common/IconPicker.svelte";
  import type {
    Background,
    Group,
    PageRegistry,
    Placement,
    Size,
  } from "$lib/types/display";
  import type { EnrichedDevice } from "$lib/types/device";

  let {
    registry,
    devices,
    selection,
    onChange,
  }: {
    registry: PageRegistry;
    devices: EnrichedDevice[];
    selection: LayoutSelection;
    onChange: (next: PageRegistry) => void;
  } = $props();

  // The preview renders at the real breakpoint, so what you see is what the
  // display will make of it.
  let width = $state(1400);
  onMount(() => {
    const onResize = () => (width = window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });
  /** Which icon field the picker is open for, if any. */
  let iconPicker = $state<null | "page" | "section">(null);
  const bp = $derived(breakpointFor(width));
  const def = $derived(
    BREAKPOINTS.find((b) => b.name === bp) ?? BREAKPOINTS[0],
  );

  const page = $derived(registry.pages.find((p) => p.id === selection.pageId));
  const section = $derived(
    selection.kind === "page"
      ? undefined
      : page?.groups.find((g) => g.id === selection.sectionId),
  );
  const tile = $derived(
    selection.kind === "tile"
      ? (section?.tiles ?? []).find((t) => t.id === selection.placementId)
      : undefined,
  );
  const device = $derived(
    tile ? devices.find((d) => d.id === tile.device) : undefined,
  );

  // The preview resolves through the display's own resolver, so it needs the
  // same device shape the display feeds it.
  type DisplayDevice = EnrichedDevice & FilterableDevice;
  const displayDevices = $derived(
    devices.map((d) => toFilterable(d)) as DisplayDevice[],
  );

  /** Page fields: an empty value removes the property. */
  function setPage(patch: Partial<{ title: string; icon: string }>): void {
    if (!page) return;
    const next: Record<string, unknown> = {};
    if ("title" in patch) next.title = patch.title?.trim() || undefined;
    if ("icon" in patch) next.icon = patch.icon?.trim() || undefined;
    onChange(patchPage(registry, page.id, next));
  }

  /**
   * Section fields. `appearance` is rebuilt field by field so clearing the last
   * one removes the object instead of leaving `{}` behind.
   */
  function setSection(
    patch: Partial<{
      title: string;
      icon: string;
      border: boolean;
      newLine: boolean;
      background: Background | undefined;
    }>,
  ): void {
    if (!page || !section) return;
    const next: Partial<Group> = {};
    if ("title" in patch) next.title = patch.title?.trim() || undefined;
    if ("icon" in patch) next.icon = patch.icon?.trim() || undefined;
    if ("newLine" in patch) next.newLine = patch.newLine ? true : undefined;
    if ("border" in patch || "background" in patch) {
      const appearance = { ...(section.appearance ?? {}) };
      if ("border" in patch) {
        appearance.border = patch.border ? true : undefined;
      }
      if ("background" in patch) appearance.background = patch.background;
      next.appearance = Object.values(appearance).some((v) => v !== undefined)
        ? appearance
        : undefined;
    }
    onChange(patchSection(registry, page.id, section.id, next));
  }

  /** Tile fields: title, and the placement's own size (its other config is P2). */
  function setTile(patch: Partial<Placement>): void {
    if (!page || !section || !tile) return;
    onChange(patchPlacement(registry, page.id, section.id, tile.id, patch));
  }

  /**
   * The size the tile actually renders at: its placement's own size when set,
   * else its template's — the same calculation the display and the section pass
   * use. The fields must never show (or write back) a size other than this, or
   * editing one axis silently changes the other.
   */
  function effectiveTileSpan(): TileSpan {
    if (!tile) return { w: 1, h: 1 };
    return effectiveSpan(
      tile.tile,
      devices.find((d) => d.id === tile!.device),
      getTemplateRegistry().templates,
      bp,
    );
  }

  function setSize(axis: "w" | "h", raw: string): void {
    if (!tile) return;
    const value = Number(raw);
    if (!value) return;
    // `effectiveSpan` clamps to the breakpoint's maximum (never above 4), so the
    // values are a valid Size.
    const size = { ...effectiveTileSpan() } as Size;
    size[axis] = value as 1 | 2 | 3 | 4;
    setTile({ tile: { ...(tile.tile ?? {}), size } });
  }
</script>

<div class="details">
  {#if page && selection.kind === "page"}
    <h3>{page.title || "Page"}</h3>
    <label class="field">
      <span class="label-mono">Title</span>
      <input
        type="text"
        value={page.title ?? ""}
        placeholder="Page title"
        oninput={(e) => setPage({ title: e.currentTarget.value })}
      />
    </label>
    <label class="field">
      <span class="label-mono">Icon</span>
      <div class="row">
        <input
          type="text"
          value={page.icon ?? ""}
          placeholder="material symbol, e.g. home"
          oninput={(e) => setPage({ icon: e.currentTarget.value })}
        />
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => (iconPicker = "page")}>Choose…</button
        >
        {#if page.icon}<span class="glyph"
            ><Icon value={page.icon} size={20} /></span
          >{/if}
      </div>
    </label>
  {:else if selection.kind === "section" && section}
    <h3>{section.title || "Section"}</h3>
    <label class="field">
      <span class="label-mono">Title</span>
      <input
        type="text"
        value={section.title ?? ""}
        placeholder="no title (header-less)"
        oninput={(e) => setSection({ title: e.currentTarget.value })}
      />
    </label>
    <label class="field">
      <span class="label-mono">Icon</span>
      <div class="row">
        <input
          type="text"
          value={section.icon ?? ""}
          placeholder="material symbol"
          oninput={(e) => setSection({ icon: e.currentTarget.value })}
        />
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => (iconPicker = "section")}>Choose…</button
        >
        {#if section.icon}<span class="glyph"
            ><Icon value={section.icon} size={20} /></span
          >{/if}
      </div>
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={section.appearance?.border === true}
        onchange={(e) => setSection({ border: e.currentTarget.checked })}
      />
      <span>Draw a border around this section</span>
    </label>
    <div class="field">
      <span class="label-mono">Background</span>
      <div class="row">
        <select
          aria-label="Background kind"
          value={section.appearance?.background?.kind ?? ""}
          onchange={(e) =>
            setSection({
              background: e.currentTarget.value
                ? {
                    kind: e.currentTarget.value as Background["kind"],
                    value: section.appearance?.background?.value ?? "",
                  }
                : undefined,
            })}
        >
          <option value="">none</option>
          <option value="solid">solid</option>
          <option value="gradient">gradient</option>
          <option value="image">image url</option>
        </select>
        {#if section.appearance?.background}
          <input
            type="text"
            value={section.appearance.background.value}
            placeholder={section.appearance.background.kind === "solid"
              ? "#101418"
              : "linear-gradient(…) / url"}
            oninput={(e) =>
              setSection({
                background: {
                  kind: section.appearance!.background!.kind,
                  value: e.currentTarget.value,
                },
              })}
          />
        {/if}
      </div>
    </div>

    <label class="check">
      <input
        type="checkbox"
        checked={section.newLine === true}
        onchange={(e) => setSection({ newLine: e.currentTarget.checked })}
      />
      <span>Start a new line before this section</span>
    </label>

    <div
      class="preview"
      style={`--tile-w: ${def.tileW}px; --tile-h: ${def.tileH}px;`}
    >
      <GroupSection
        group={section}
        tiles={resolveSection(section, displayDevices)}
        {bp}
        pageId={page?.id ?? ""}
      />
    </div>
  {:else if selection.kind === "tile" && tile}
    <h3>{tile.title || device?.name || "Tile"}</h3>
    <label class="field">
      <span class="label-mono">Tile title</span>
      <input
        type="text"
        value={tile.title ?? ""}
        placeholder={device?.name ?? "defaults to the device name"}
        oninput={(e) =>
          setTile({ title: e.currentTarget.value.trim() || undefined })}
      />
    </label>
    <div class="field">
      <span class="label-mono">Device</span>
      {#if device}
        <span class="device-name">{device.name}</span>
      {:else}
        <span class="warn">This device is not in the registry any more.</span>
      {/if}
    </div>
    <label class="check">
      <input
        type="checkbox"
        checked={tile.newLine === true}
        onchange={(e) => setTile({ newLine: e.currentTarget.checked })}
      />
      <span>Start a new line before this tile</span>
    </label>

    <div class="field">
      <span class="label-mono">Size (modules)</span>
      <div class="row">
        {#each ["w", "h"] as axis (axis)}
          <label class="small">
            <span class="label-mono">{axis}</span>
            <select
              aria-label={`Size ${axis}`}
              value={String(
                axis === "w" ? effectiveTileSpan().w : effectiveTileSpan().h,
              )}
              onchange={(e) =>
                setSize(axis as "w" | "h", e.currentTarget.value)}
            >
              {#each [1, 2, 3, 4] as n (n)}
                <option value={String(n)}>{n}</option>
              {/each}
            </select>
          </label>
        {/each}
      </div>
    </div>

    {#if device}
      <div
        class="preview tile-grid"
        style={`--tile-w: ${def.tileW}px; --tile-h: ${def.tileH}px;`}
      >
        <Tile {device} {bp} title={tile.title} tile={tile.tile} />
      </div>
    {/if}
  {/if}

  {#if iconPicker}
    <IconPicker
      icon={iconPicker === "page" ? page?.icon : section?.icon}
      onPick={(value) => {
        if (iconPicker === "page") setPage({ icon: value });
        else setSection({ icon: value });
        iconPicker = null;
      }}
      onClose={() => (iconPicker = null)}
    />
  {/if}
</div>

<style>
  .details {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }

  .details h3 {
    margin: 0;
    font-size: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .field .glyph {
    display: inline-flex;
    color: var(--text-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .row input[type="text"] {
    flex: 1 1 auto;
    min-width: 0;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--body-sm);
  }

  .small {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .device-name {
    font-size: var(--body-sm);
  }

  .warn {
    color: var(--warning-color);
    font-size: var(--body-sm);
  }

  /* The preview is a real tile grid at the current breakpoint's module size,
     so a tile shows at the width and height the display will give it. */
  .preview {
    margin-top: 0.25rem;
    padding: 0.5rem;
    border: 1px dashed var(--border-color);
    border-radius: var(--border-radius-md, 12px);
  }

  .tile-grid {
    display: grid;
    gap: 6px;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile-w, 57px), 1fr));
    grid-auto-rows: minmax(var(--tile-h, 114px), auto);
  }
</style>
