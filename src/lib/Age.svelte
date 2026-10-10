<script>
  import { ageString } from "$lib/tools.svelte.js";
  import { time } from "$lib/time.svelte.js";

  let { ts, st } = $props();

  const age = $derived.by(() => {
    const t = ts ?? st?.ts;
    if (typeof t !== "number" || isNaN(t)) return null;
    return time.now - t;
  });

  const label = $derived.by(() => {
    if (age === null) return "—";
    if (age < 4000) return "now";
    return `${ageString(age)} ago`;
  });
</script>

<span>{label}</span>
