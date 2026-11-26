<script lang="ts">
  import ContextMenu from "$lib/components/common/ContextMenu.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import SaveTemplateModal from "$lib/components/templates/SaveTemplateModal.svelte";
  import { displayTileMenuItems } from "$lib/config/layout-menu";
  import {
    deletePlacement,
    duplicatePlacement,
    type LayoutSelection,
  } from "$lib/config/layout-ops";
  import { inferTemplateType } from "$lib/config/tile-template";
  import { planSaveTileTemplate } from "$lib/config/tile-template-save";
  import type { SourceLook } from "$lib/config/slot-source";
  import { requestLayoutConfig } from "$lib/pages.js";
  import {
    commitLayout,
    getPageRegistry,
    isLayoutWritable,
  } from "$lib/stores/pages.svelte.js";
  import {
    commitTemplates,
    getTemplateRegistry,
    isTemplatesWritable,
  } from "$lib/stores/templates.svelte.js";
  import { getVariables } from "$lib/stores/variables.svelte";
  import {
    getDerived,
    getOverrideRegistry,
  } from "$lib/stores/overrides.svelte";
  import { openSheetGated, runSheetGated } from "$lib/stores/sheet.svelte.js";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { newId } from "$lib/utils/ids";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { toast } from "$lib/stores/toasts.svelte";
  import type { DeviceType } from "$lib/types/device";

  let {
    x,
    y,
    selection,
    onclose,
  }: {
    x: number;
    y: number;
    selection: Extract<LayoutSelection, { kind: "tile" }>;
    onclose: () => void;
  } = $props();

  let confirmOpen = $state(false);
  let saveOpen = $state(false);
  let saveError = $state("");

  const registry = $derived(getPageRegistry());
  const page = $derived(
    registry.pages.find((entry) => entry.id === selection.pageId),
  );
  const section = $derived(
    page?.groups.find((group) => group.id === selection.sectionId),
  );
  const placement = $derived(
    section?.tiles.find((tile) => tile.id === selection.placementId),
  );
  const title = $derived(placement?.title?.trim() || "Tile");
  const writable = $derived(isLayoutWritable());
  const templatesWritable = $derived(isTemplatesWritable());
  const sourceLook = $derived<SourceLook>({
    states: (ioBroker.states ?? new Map()) as Map<string, any>,
    objects: (ioBroker.objects ?? new Map()) as Map<string, any>,
    variables: getVariables(),
    overrides: getOverrideRegistry().overrides,
    derived: getDerived,
  });
  const templateType = $derived(inferTemplateType(placement?.tile, sourceLook));
  const templateName = $derived(`${templateType} template`);
  const items = $derived(
    displayTileMenuItems({ writable, templatesWritable }).map((entry) => ({
      ...entry,
      run: () => run(entry.id),
    })),
  );

  function run(id: string): void {
    if (id === "edit") {
      requestLayoutConfig({
        pageId: selection.pageId,
        sectionId: selection.sectionId,
        placementId: selection.placementId,
      });
      openSheetGated();
      closeAll();
      return;
    }
    if (id === "duplicate") {
      duplicate();
      return;
    }
    if (id === "save-template") {
      if (!placement?.tile) return;
      saveError = "";
      saveOpen = true;
      return;
    }
    if (id === "delete") confirmOpen = true;
  }

  function closeAll(): void {
    confirmOpen = false;
    saveOpen = false;
    onclose();
  }

  /** ContextMenu always closes after running an item. Keep this component
   *  mounted while its confirm/save modal is the next thing on screen. */
  function menuClosed(): void {
    if (confirmOpen || saveOpen) return;
    onclose();
  }

  function duplicate(): void {
    if (!writable) return;
    commitLayout(
      duplicatePlacement(
        getPageRegistry(),
        selection.pageId,
        selection.sectionId,
        selection.placementId,
      ),
    );
    onclose();
  }

  function confirmDelete(): void {
    confirmOpen = false;
    runSheetGated(() => {
      if (!isLayoutWritable()) return;
      commitLayout(
        deletePlacement(
          getPageRegistry(),
          selection.pageId,
          selection.sectionId,
          selection.placementId,
        ),
      );
    }, "Enter PIN to delete the tile");
    onclose();
  }

  function saveTemplate(name: string, type: DeviceType, hint: string): void {
    saveError = "";
    const config = placement?.tile;
    if (!config) return;
    const plan = planSaveTileTemplate(
      getTemplateRegistry(),
      config,
      sourceLook,
      { id: newId(), name, type, hint },
    );
    if (plan.error || !plan.next) {
      saveError = plan.error ?? "The template document could not be saved.";
      return;
    }
    if (!isTemplatesWritable() || !commitTemplates(plan.next)) {
      saveError = "The template document could not be saved.";
      return;
    }
    saveOpen = false;
    onclose();
    if (plan.note) toast.success(plan.note);
  }
</script>

{#if !confirmOpen && !saveOpen}
  <ContextMenu
    {x}
    {y}
    heading={title}
    label="Tile actions"
    {items}
    onclose={menuClosed}
  />
{/if}

{#if confirmOpen}
  <ConfirmModal
    title={deleteTitle("tile", title)}
    confirmLabel="Delete"
    onConfirm={confirmDelete}
    onCancel={closeAll}
  />
{/if}

{#if saveOpen && placement?.tile}
  <SaveTemplateModal
    suggestedName={templateName}
    suggestedType={templateType}
    error={saveError}
    onSave={saveTemplate}
    onClose={closeAll}
  />
{/if}
