<script lang="ts">
  import { untrack } from "svelte";

  let {
    title,
    pages,
    currentPageId,
    currentSectionId,
    onMove,
    onClose,
  }: {
    title: string;
    pages: {
      id: string;
      title?: string;
      sections: { id: string; title?: string }[];
    }[];
    currentPageId: string;
    currentSectionId: string;
    onMove: (pageId: string, sectionId: string) => void;
    onClose: () => void;
  } = $props();

  const key = (pageId: string, sectionId: string) => `${pageId}|${sectionId}`;
  const current = $derived(key(currentPageId, currentSectionId));
  let target = $state(
    untrack(() => {
      const own = pages.find((p) => p.id === currentPageId);
      for (const section of own?.sections ?? []) {
        const value = key(currentPageId, section.id);
        if (value !== current) return value;
      }
      return "";
    }),
  );

  function confirm(): void {
    if (!target || target === current) return;
    const [pageId, sectionId] = target.split("|");
    onMove(pageId, sectionId);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onClose();
  }}
/>

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label={title}
  tabindex="-1"
>
  <div class="modal-card card">
    <h3>{title}</h3>
    <label class="field">
      <span class="label-mono">Destination section</span>
      <select bind:value={target}>
        {#each pages as page (page.id)}
          <optgroup label={page.title || "Page"}>
            {#each page.sections as section (section.id)}
              {@const value = key(page.id, section.id)}
              <option {value} disabled={value === current}>
                {section.title || "Section"}{value === current
                  ? " (current)"
                  : ""}
              </option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <div class="actions">
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={!target || target === current}
        onclick={confirm}>Move</button
      >
    </div>
  </div>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 1rem;
  }

  .modal-card {
    width: min(420px, 100%);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .modal-card h3 {
    margin: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
