<script lang="ts">
  import type { Transform, TransformStep } from "$lib/types/device";
  import { previewTransform } from "$lib/config/transform-ops";
  import { untrack } from "svelte";

  let {
    transform = undefined,
    sampleValue = undefined,
    onChange,
  }: {
    transform?: Transform;
    sampleValue?: unknown;
    onChange: (t: Transform | undefined) => void;
  } = $props();

  let dir = $state<"read" | "write">("read");
  // initial sample only; the parent keys this editor per control
  let sample = $state<string>(
    untrack(() => (sampleValue == null ? "" : String(sampleValue))),
  );
  let rows = $state<{ k: string; v: string }[]>([]);
  let syncedFor = $state("");

  const step = $derived(transform?.[dir]);
  const kind = $derived(step?.kind ?? "none");

  // Re-seed the map rows only when the direction or kind changes (not on every
  // keystroke, so editing stays stable).
  $effect(() => {
    const s = transform?.[dir];
    const key = `${dir}:${s?.kind ?? "none"}`;
    if (key !== syncedFor) {
      syncedFor = key;
      rows =
        s?.kind === "map"
          ? Object.entries(s.map).map(([k, v]) => ({ k, v: String(v) }))
          : [];
    }
  });

  function setStep(next: TransformStep | undefined) {
    const t: Transform = { ...(transform ?? {}) };
    if (next) t[dir] = next;
    else delete t[dir];
    onChange(t.read || t.write ? t : undefined);
  }

  function setKind(next: string) {
    if (next === "none") return setStep(undefined);
    if (next === "scale")
      return setStep({
        kind: "scale",
        inMin: 0,
        inMax: 100,
        outMin: 0,
        outMax: 1,
        clamp: true,
      });
    if (next === "map") return setStep({ kind: "map", map: {} });
    if (next === "formula") return setStep({ kind: "formula", expr: "x" });
    if (next === "jsonpath") return setStep({ kind: "jsonpath", path: "" });
  }

  function coerce(s: string): unknown {
    if (s === "") return "";
    if (s === "true") return true;
    if (s === "false") return false;
    const n = Number(s);
    return Number.isNaN(n) ? s : n;
  }

  function pushRows() {
    const map: Record<string, unknown> = {};
    for (const r of rows) if (r.k !== "") map[r.k] = coerce(r.v);
    setStep({ kind: "map", map });
  }

  const preview = $derived(previewTransform(step, coerce(sample)));
</script>

<div class="transform-editor">
  <div class="tabs">
    <button
      type="button"
      class="tab"
      class:active={dir === "read"}
      onclick={() => (dir = "read")}
    >
      Read (input)
    </button>
    <button
      type="button"
      class="tab"
      class:active={dir === "write"}
      onclick={() => (dir = "write")}
    >
      Write (output)
    </button>
  </div>

  <label class="field">
    <span class="label-mono">Transform</span>
    <select value={kind} onchange={(e) => setKind(e.currentTarget.value)}>
      <option value="none">None</option>
      <option value="scale">Scale</option>
      <option value="map">Map</option>
      <option value="formula">Formula</option>
      {#if dir === "read"}
        <option value="jsonpath">JSON path</option>
      {/if}
    </select>
  </label>

  {#if step?.kind === "scale"}
    <div class="grid">
      <label class="field"
        ><span class="label-mono">in min</span>
        <input
          type="number"
          value={step.inMin}
          oninput={(e) =>
            setStep({ ...step, inMin: Number(e.currentTarget.value) })}
        /></label
      >
      <label class="field"
        ><span class="label-mono">in max</span>
        <input
          type="number"
          value={step.inMax}
          oninput={(e) =>
            setStep({ ...step, inMax: Number(e.currentTarget.value) })}
        /></label
      >
      <label class="field"
        ><span class="label-mono">out min</span>
        <input
          type="number"
          value={step.outMin}
          oninput={(e) =>
            setStep({ ...step, outMin: Number(e.currentTarget.value) })}
        /></label
      >
      <label class="field"
        ><span class="label-mono">out max</span>
        <input
          type="number"
          value={step.outMax}
          oninput={(e) =>
            setStep({ ...step, outMax: Number(e.currentTarget.value) })}
        /></label
      >
      <label class="field"
        ><span class="label-mono">round</span>
        <input
          type="number"
          value={step.round ?? ""}
          oninput={(e) =>
            setStep({
              ...step,
              round:
                e.currentTarget.value === ""
                  ? undefined
                  : Number(e.currentTarget.value),
            })}
        /></label
      >
      <label class="check"
        ><input
          type="checkbox"
          checked={step.clamp !== false}
          onchange={(e) => setStep({ ...step, clamp: e.currentTarget.checked })}
        /> clamp</label
      >
    </div>
  {:else if step?.kind === "map"}
    <div class="map-rows">
      {#each rows as row, i (i)}
        <div class="map-row">
          <input
            type="text"
            placeholder="from"
            bind:value={row.k}
            oninput={pushRows}
          />
          <input
            type="text"
            placeholder="to"
            bind:value={row.v}
            oninput={pushRows}
          />
          <button
            type="button"
            class="icon-btn"
            aria-label="Remove row"
            onclick={() => {
              rows = rows.filter((_, j) => j !== i);
              pushRows();
            }}
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      {/each}
      <button
        type="button"
        class="btn"
        onclick={() => (rows = [...rows, { k: "", v: "" }])}>Add row</button
      >
    </div>
  {:else if step?.kind === "formula"}
    <label class="field"
      ><span class="label-mono">Expression (x)</span>
      <input
        type="text"
        value={step.expr}
        oninput={(e) =>
          setStep({ kind: "formula", expr: e.currentTarget.value })}
      /></label
    >
  {:else if step?.kind === "jsonpath"}
    <label class="field"
      ><span class="label-mono">Path</span>
      <input
        type="text"
        placeholder="a.b[0].c"
        value={step.path}
        oninput={(e) =>
          setStep({ kind: "jsonpath", path: e.currentTarget.value })}
      /></label
    >
  {/if}

  {#if step}
    <div class="preview">
      <label class="field"
        ><span class="label-mono">Sample</span>
        <input type="text" bind:value={sample} /></label
      >
      <div class="preview-out">
        <span class="label-mono">Preview</span>
        {#if preview.error}
          <span class="err">{preview.error} — using raw value</span>
        {:else}
          <span class="mono">{String(preview.value)}</span>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .transform-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-container-low, #fafafa);
  }

  .tabs {
    display: inline-flex;
    gap: 2px;
    align-self: flex-start;
  }

  .tab {
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-muted);
    padding: 0.25rem 0.6rem;
    cursor: pointer;
  }

  .tab.active {
    background: var(--primary-container);
    color: var(--on-primary-container);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    align-items: end;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .map-rows {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .map-row {
    display: flex;
    gap: 0.35rem;
  }

  .map-row input {
    flex: 1;
    min-width: 0;
  }

  .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .preview {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    align-items: end;
  }

  .preview-out {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .err {
    color: var(--danger-color, #c0392b);
    font-size: var(--body-sm);
  }

  .mono {
    font-family: var(--font-mono);
  }
</style>
