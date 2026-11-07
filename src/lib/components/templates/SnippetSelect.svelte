<script lang="ts">
  import { snippetChoices, type SnippetMode } from "$lib/config/snippets";
  import { getFunctions } from "$lib/stores/functions.svelte";

  let {
    mode = "both",
    onInsert,
    onBeforeOpen,
    label = "Insert snippet",
  }: {
    mode?: SnippetMode;
    onInsert: (code: string) => void;
    onBeforeOpen?: () => void;
    label?: string;
  } = $props();

  const choices = $derived(snippetChoices(getFunctions(), mode));
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
  <option value="">— snippet —</option>
  {#each choices as choice (choice.id)}
    <option value={choice.id}>{choice.name}</option>
  {/each}
</select>
