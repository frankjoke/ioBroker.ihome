<script lang="ts">
  import { codeTemplateChoices, type SnippetMode } from "$lib/config/snippets";
  import { getFunctions } from "$lib/stores/functions.svelte";
  import { getFormulas } from "$lib/stores/formulas.svelte";
  import {
    ensurePluginContributions,
    getPluginContributions,
    pluginContributionsProblem,
  } from "$lib/stores/plugin-contributions.svelte";
  import { getPluginsVersion } from "$lib/stores/plugins.svelte";

  let {
    mode = "both",
    onInsert,
    onBeforeOpen,
    label = "Insert a code template",
  }: {
    mode?: SnippetMode;
    onInsert: (code: string) => void;
    onBeforeOpen?: () => void;
    label?: string;
  } = $props();

  $effect(() => {
    getPluginsVersion();
    void ensurePluginContributions();
  });

  const pluginSet = $derived(getPluginContributions());
  const choices = $derived(
    codeTemplateChoices(
      getFunctions(),
      getFormulas(),
      mode,
      pluginSet.functions,
      pluginSet.formulas,
    ),
  );
  const byId = $derived(new Map(choices.map((entry) => [entry.id, entry])));
</script>

<select
  aria-label={label}
  title={label}
  value=""
  onmousedown={() => onBeforeOpen?.()}
  onchange={(event) => {
    const select = event.currentTarget;
    const choice = byId.get(select.value);
    select.selectedIndex = 0;
    if (choice) onInsert(choice.code);
  }}
>
  <option value="">— code template —</option>
  {#each choices as choice (choice.id)}
    <option value={choice.id}>{choice.name}</option>
  {/each}
</select>

{#if pluginContributionsProblem() || pluginSet.problems.length}
  <p class="hint text-danger">
    {pluginContributionsProblem() || pluginSet.problems.join(" ")}
  </p>
{/if}
