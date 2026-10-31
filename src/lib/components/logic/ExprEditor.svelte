<script lang="ts">
  import IconButton from "$lib/components/common/IconButton.svelte";
  import type { Expr, FunctionExpr } from "$logic/types";
  import Self from "./ExprEditor.svelte";

  let {
    expr,
    onchange,
    allowNoop = false,
  }: {
    expr: FunctionExpr;
    onchange: (expr: FunctionExpr) => void;
    allowNoop?: boolean;
  } = $props();

  // One permissive view for the markup: the union's narrowing inside template
  // conditions is not reliable, and every access is guarded by the branch.
  const e = $derived(expr as any);

  const KINDS = $derived([
    { id: "const", label: "Value" },
    { id: "ref", label: "Input / memory / state" },
    { id: "compare", label: "Compare" },
    { id: "logic", label: "And / or / not" },
    { id: "math", label: "Arithmetic" },
    { id: "helper", label: "Round / min / max / clamp" },
    { id: "if", label: "If … then … else" },
    ...(allowNoop ? [{ id: "noop", label: "No update" }] : []),
  ]);

  const COMPARE = ["eq", "ne", "gt", "gte", "lt", "lte"];
  const MATH = ["add", "sub", "mul", "div", "mod"];
  const HELPER = ["round", "abs", "neg", "min", "max", "clamp", "len"];

  function kindOf(value: FunctionExpr): string {
    if ("noop" in value) return "noop";
    if ("const" in value) return "const";
    if ("ref" in value) return "ref";
    if (COMPARE.includes(value.op)) return "compare";
    if (value.op === "and" || value.op === "or" || value.op === "not")
      return "logic";
    if (MATH.includes(value.op)) return "math";
    if (value.op === "if") return "if";
    return "helper";
  }

  const kind = $derived(kindOf(expr));

  function pickKind(next: string) {
    switch (next) {
      case "noop":
        onchange({ noop: true });
        break;
      case "const":
        onchange({ const: 0 });
        break;
      case "ref":
        onchange({ ref: "" });
        break;
      case "compare":
        onchange({ op: "eq", left: { ref: "" }, right: { const: "" } });
        break;
      case "logic":
        onchange({ op: "and", of: [{ ref: "" }, { ref: "" }] });
        break;
      case "math":
        onchange({ op: "add", left: { ref: "" }, right: { const: 0 } });
        break;
      case "if":
        onchange({
          op: "if",
          cond: { ref: "" },
          then: { const: 0 },
          else: { const: 0 },
        });
        break;
      default:
        onchange({ op: "round", of: { ref: "" } });
        break;
    }
  }

  function asExpr(value: FunctionExpr): Expr {
    return "noop" in value ? { const: 0 } : value;
  }

  function patch(update: Record<string, unknown>) {
    onchange({ ...(expr as any), ...update });
  }

  function numberValue(event: Event): number {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    return Number.isFinite(value) ? value : 0;
  }
</script>

<div class="expr">
  <div class="expr-head">
    <select
      aria-label="Expression kind"
      value={kind}
      onchange={(event) => pickKind(event.currentTarget.value)}
    >
      {#each KINDS as entry (entry.id)}
        <option value={entry.id}>{entry.label}</option>
      {/each}
    </select>

    {#if "const" in e}
      <input
        aria-label="Constant"
        value={String(e.const)}
        onchange={(event) => {
          const raw = event.currentTarget.value;
          const number = Number(raw);
          onchange(
            raw.trim() !== "" && Number.isFinite(number)
              ? { const: number }
              : { const: raw },
          );
        }}
      />
    {:else if "ref" in e}
      <input
        aria-label="Reference"
        placeholder="input name, memory name or state id"
        value={e.ref}
        onchange={(event) =>
          onchange({ ref: event.currentTarget.value.trim() })}
      />
    {:else if e.op === "and" || e.op === "or"}
      <select
        aria-label="Logic operator"
        value={e.op}
        onchange={(event) => patch({ op: event.currentTarget.value })}
      >
        <option value="and">and</option>
        <option value="or">or</option>
      </select>
    {:else if e.op === "not"}
      <span class="hint text-muted">not</span>
    {:else if e.op === "if"}
      <span class="hint text-muted">if</span>
    {:else if e.op}
      <select
        aria-label="Operator"
        value={e.op}
        onchange={(event) => patch({ op: event.currentTarget.value })}
      >
        {#if COMPARE.includes(e.op)}
          {#each COMPARE as op (op)}
            <option value={op}>{op}</option>
          {/each}
        {:else if MATH.includes(e.op)}
          {#each MATH as op (op)}
            <option value={op}>{op}</option>
          {/each}
        {:else}
          {#each HELPER as op (op)}
            <option value={op}>{op}</option>
          {/each}
        {/if}
      </select>
    {/if}
  </div>

  {#if "const" in e || "ref" in e || "noop" in e}
    <!-- leaf -->
  {:else if e.op === "and" || e.op === "or" || e.op === "min" || e.op === "max"}
    <div class="expr-list">
      {#each e.of as item, index (index)}
        <div class="expr-row">
          <Self
            expr={item}
            onchange={(next) => {
              const of = [...e.of];
              of[index] = asExpr(next);
              patch({ of });
            }}
          />
          <IconButton
            icon="remove"
            label="Remove operand"
            disabled={e.of.length <= 2}
            onclick={() => patch({ of: e.of.filter((_, i) => i !== index) })}
          />
        </div>
      {/each}
      <button
        type="button"
        class="btn btn-sm"
        onclick={() => patch({ of: [...e.of, { const: 0 }] })}>Add</button
      >
    </div>
  {:else if e.op === "not" || e.op === "neg" || e.op === "round" || e.op === "abs" || e.op === "len"}
    <div class="expr-row">
      <Self expr={e.of} onchange={(next) => patch({ of: asExpr(next) })} />
    </div>
  {:else if e.op === "clamp"}
    <div class="expr-row">
      <Self expr={e.of} onchange={(next) => patch({ of: asExpr(next) })} />
      <label class="inline"
        >min <input
          type="number"
          value={e.min}
          onchange={(event) => patch({ min: numberValue(event) })}
        /></label
      >
      <label class="inline"
        >max <input
          type="number"
          value={e.max}
          onchange={(event) => patch({ max: numberValue(event) })}
        /></label
      >
    </div>
  {:else if e.op === "if"}
    <div class="expr-branches">
      <div class="expr-row">
        <span class="label-mono">if</span>
        <Self
          expr={e.cond}
          onchange={(next) => patch({ cond: asExpr(next) })}
        />
      </div>
      <div class="expr-row">
        <span class="label-mono">then</span>
        <Self
          expr={e.then}
          {allowNoop}
          onchange={(next) => patch({ then: next })}
        />
      </div>
      <div class="expr-row">
        <span class="label-mono">else</span>
        <Self
          expr={e.else}
          {allowNoop}
          onchange={(next) => patch({ else: next })}
        />
      </div>
    </div>
  {:else if e.left}
    <div class="expr-row">
      <Self expr={e.left} onchange={(next) => patch({ left: asExpr(next) })} />
      <span class="hint text-muted">{e.op}</span>
      <Self
        expr={e.right}
        onchange={(next) => patch({ right: asExpr(next) })}
      />
    </div>
  {/if}
</div>

<style>
  .expr {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border-left: 2px solid var(--border-color);
    padding-left: 0.6rem;
  }

  .expr-head,
  .expr-row,
  .inline {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .expr-list,
  .expr-branches {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .inline input {
    width: 5rem;
  }
</style>
