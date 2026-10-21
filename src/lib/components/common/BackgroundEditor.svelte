<script lang="ts">
  import {
    backgroundCss,
    gradientValue,
    inspectGradient,
    isHexColor,
  } from "$lib/config/appearance";
  import type { Background } from "$lib/types/display";

  let {
    background = undefined,
    onChange,
  }: {
    background?: Background;
    onChange: (bg: Background | undefined) => void;
  } = $props();

  const value = $derived(background?.value ?? "");
  const kind = $derived(background?.kind ?? "");

  /**
   * The structured form when the builder can show it — and only then: a gradient
   * whose stops are not hex (hand-written, or named colours) stays raw text, so
   * the colour inputs can never silently replace it.
   */
  const parts = $derived(
    background?.kind === "gradient" ? inspectGradient(value) : null,
  );
  const builder = $derived(
    parts !== null && isHexColor(parts.from) && isHexColor(parts.to)
      ? parts
      : null,
  );

  function setKind(raw: string) {
    if (!raw) {
      onChange(undefined);
      return;
    }
    const next = raw as Background["kind"];
    let nextValue = value;
    if (next === "gradient" && !inspectGradient(nextValue)) {
      // Switching to gradient lands in the builder, not an empty raw field.
      nextValue = gradientValue(180, "#101418", "#2a3550");
    }
    onChange({ kind: next, value: nextValue });
  }

  function setValue(next: string) {
    onChange({ kind: background?.kind ?? "solid", value: next });
  }

  /** Angle and colours write back through the builder, angle clamped to 0-360. */
  function setGradient(angle: number, from: string, to: string) {
    const a = Number.isFinite(angle)
      ? Math.max(0, Math.min(360, Math.round(angle)))
      : 180;
    onChange({ kind: "gradient", value: gradientValue(a, from, to) });
  }
</script>

<div class="bg">
  <div class="row">
    <select
      aria-label="Background kind"
      value={kind}
      onchange={(e) => setKind(e.currentTarget.value)}
    >
      <option value="">none</option>
      <option value="solid">solid</option>
      <option value="gradient">gradient</option>
      <option value="image">image url</option>
    </select>

    {#if background?.kind === "solid"}
      <input
        type="color"
        aria-label="Background colour"
        value={isHexColor(value) ? value : "#000000"}
        oninput={(e) => setValue(e.currentTarget.value)}
      />
      <input
        type="text"
        {value}
        placeholder="#101418"
        oninput={(e) => setValue(e.currentTarget.value)}
      />
    {:else if background?.kind === "gradient"}
      {#if builder}
        <input
          type="color"
          aria-label="Gradient from"
          value={builder.from}
          oninput={(e) =>
            setGradient(builder.angle, e.currentTarget.value, builder.to)}
        />
        <input
          type="color"
          aria-label="Gradient to"
          value={builder.to}
          oninput={(e) =>
            setGradient(builder.angle, builder.from, e.currentTarget.value)}
        />
        <input
          type="number"
          class="angle"
          aria-label="Gradient angle"
          min="0"
          max="360"
          value={builder.angle}
          oninput={(e) =>
            setGradient(
              Number(e.currentTarget.value),
              builder.from,
              builder.to,
            )}
        />
      {:else}
        <input
          type="text"
          {value}
          placeholder="linear-gradient(180deg, #101418, #2a3550)"
          oninput={(e) => setValue(e.currentTarget.value)}
        />
      {/if}
    {:else if background?.kind === "image"}
      <input
        type="text"
        {value}
        placeholder="https://… or adapter/name.png"
        oninput={(e) => setValue(e.currentTarget.value)}
      />
    {/if}
  </div>

  <div class="preview" style={backgroundCss(background)}></div>
</div>

<style>
  .bg {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    flex-wrap: wrap;
  }

  .row input[type="text"] {
    flex: 1 1 auto;
    min-width: 0;
  }

  .row input[type="color"] {
    width: 34px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
  }

  .angle {
    width: 4.5rem;
  }

  .preview {
    height: 28px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
  }
</style>
