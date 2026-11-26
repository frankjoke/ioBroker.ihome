<script lang="ts">
  import ContextMenu from "$lib/components/common/ContextMenu.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import NameModal from "$lib/components/common/NameModal.svelte";
  import SaveTemplateModal from "$lib/components/templates/SaveTemplateModal.svelte";
  import MoveTileModal from "$lib/components/layout/MoveTileModal.svelte";
  import MoveSectionModal from "$lib/components/layout/MoveSectionModal.svelte";
  import {
    displayMenuItems,
    layoutMenuTargetKind,
    type LayoutMenuId,
  } from "$lib/config/layout-menu";
  import {
    addSection,
    deletePlacement,
    deleteSection,
    duplicatePlacement,
    movePlacement,
    moveSectionToPage,
    sectionTitleTaken,
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
  import {
    openSheetForNewTile,
    openSheetGated,
    runSheetGated,
  } from "$lib/stores/sheet.svelte.js";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { newId } from "$lib/utils/ids";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { toast } from "$lib/stores/toasts.svelte";
  import type { DeviceType } from "$lib/types/device";

  let {
    x,
    y,
    pageId,
    selection,
    onclose,
  }: {
    x: number;
    y: number;
    /** The page under the cursor; the target for free-space actions. */
    pageId: string;
    selection: LayoutSelection | null;
    onclose: () => void;
  } = $props();

  let confirmOpen = $state(false);
  let saveOpen = $state(false);
  let saveError = $state("");
  let moveTileOpen = $state(false);
  let moveSectionOpen = $state(false);
  let addSectionOpen = $state(false);

  const registry = $derived(getPageRegistry());
  const kind = $derived(layoutMenuTargetKind(selection));
  const page = $derived.by(() => {
    const id = selection && "pageId" in selection ? selection.pageId : pageId;
    return registry.pages.find((entry) => entry.id === id);
  });
  const section = $derived.by(() => {
    if (selection?.kind !== "tile" && selection?.kind !== "section")
      return undefined;
    return page?.groups.find((group) => group.id === selection.sectionId);
  });
  const placement = $derived(
    selection?.kind === "tile"
      ? section?.tiles.find((tile) => tile.id === selection.placementId)
      : undefined,
  );
  const title = $derived(
    kind === "tile"
      ? placement?.title?.trim() || "Tile"
      : kind === "section"
        ? section?.title?.trim() || "Section"
        : page?.title?.trim() || "Page",
  );
  const targetPageId = $derived(
    selection && "pageId" in selection ? selection.pageId : pageId,
  );
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
  const movePages = $derived(
    registry.pages.map((entry) => ({
      id: entry.id,
      title: entry.title,
      sections: (entry.groups ?? []).map((group) => ({
        id: group.id,
        title: group.title,
      })),
    })),
  );
  const deleteHeading = $derived(
    kind === "section"
      ? deleteTitle("section", section?.title || "section", {
          kind: "page",
          name: page?.title || "page",
        })
      : deleteTitle("tile", placement?.title || "tile"),
  );
  const items = $derived(
    displayMenuItems(kind, { writable, templatesWritable }).map((entry) => ({
      ...entry,
      run: () => run(entry.id),
    })),
  );

  function run(id: LayoutMenuId): void {
    if (id === "edit") {
      editTile();
      return;
    }
    if (id === "duplicate") {
      duplicateTile();
      return;
    }
    if (id === "save-template") {
      if (!placement?.tile) return;
      saveError = "";
      saveOpen = true;
      return;
    }
    if (id === "add-tile") {
      addTile();
      return;
    }
    if (id === "move") {
      moveTileOpen = true;
      return;
    }
    if (id === "move-section") {
      moveSectionOpen = true;
      return;
    }
    if (id === "delete") {
      confirmOpen = true;
      return;
    }
    if (id === "add-section") addSectionOpen = true;
  }

  function closeAll(): void {
    confirmOpen = false;
    saveOpen = false;
    moveTileOpen = false;
    moveSectionOpen = false;
    addSectionOpen = false;
    onclose();
  }

  /** ContextMenu always closes after running an item. Keep this component
   *  mounted while its follow-up modal is the next thing on screen. */
  function menuClosed(): void {
    if (
      confirmOpen ||
      saveOpen ||
      moveTileOpen ||
      moveSectionOpen ||
      addSectionOpen
    )
      return;
    onclose();
  }

  function editTile(): void {
    if (selection?.kind !== "tile") return;
    requestLayoutConfig({
      pageId: selection.pageId,
      sectionId: selection.sectionId,
      placementId: selection.placementId,
    });
    openSheetGated();
    closeAll();
  }

  function duplicateTile(): void {
    if (selection?.kind !== "tile" || !writable) return;
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

  function addTile(): void {
    if (!writable) return;
    const sectionId =
      selection?.kind === "tile" || selection?.kind === "section"
        ? selection.sectionId
        : "";
    if (!targetPageId || !sectionId) return;
    openSheetForNewTile({ pageId: targetPageId, sectionId });
    closeAll();
  }

  function confirmDelete(): void {
    confirmOpen = false;
    const target = selection;
    runSheetGated(
      () => {
        if (!isLayoutWritable()) return;
        const current = getPageRegistry();
        if (target?.kind === "tile") {
          commitLayout(
            deletePlacement(
              current,
              target.pageId,
              target.sectionId,
              target.placementId,
            ),
          );
        } else if (target?.kind === "section") {
          commitLayout(deleteSection(current, target.pageId, target.sectionId));
        }
      },
      target?.kind === "section"
        ? "Enter PIN to delete the section"
        : "Enter PIN to delete the tile",
    );
    onclose();
  }

  function moveTile(toPageId: string, toSectionId: string): void {
    if (selection?.kind !== "tile" || !section) return;
    const fromIndex = (section.tiles ?? []).findIndex(
      (tile) => tile.id === selection.placementId,
    );
    const targetSection = registry.pages
      .find((entry) => entry.id === toPageId)
      ?.groups?.find((group) => group.id === toSectionId);
    if (fromIndex < 0 || !targetSection) return;
    const next = movePlacement(
      getPageRegistry(),
      {
        pageId: selection.pageId,
        sectionId: selection.sectionId,
        index: fromIndex,
      },
      {
        pageId: toPageId,
        sectionId: toSectionId,
        index: (targetSection.tiles ?? []).length,
      },
    );
    if (!commitLayout(next)) return;
    moveTileOpen = false;
    onclose();
  }

  function moveSection(toPageId: string): void {
    if (selection?.kind !== "section") return;
    const next = moveSectionToPage(
      getPageRegistry(),
      selection.pageId,
      selection.sectionId,
      toPageId,
    );
    if (next === getPageRegistry()) {
      moveSectionOpen = false;
      return;
    }
    if (!commitLayout(next)) return;
    moveSectionOpen = false;
    onclose();
  }

  function createSection(name: string): void {
    if (!targetPageId || !writable) return;
    if (!commitLayout(addSection(getPageRegistry(), targetPageId, name)))
      return;
    addSectionOpen = false;
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

{#if !confirmOpen && !saveOpen && !moveTileOpen && !moveSectionOpen && !addSectionOpen}
  <ContextMenu
    {x}
    {y}
    heading={title}
    label={kind === "tile"
      ? "Tile actions"
      : kind === "section"
        ? "Section actions"
        : "Page actions"}
    {items}
    onclose={menuClosed}
  />
{/if}

{#if confirmOpen && (kind === "tile" || kind === "section")}
  <ConfirmModal
    title={deleteHeading}
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

{#if moveTileOpen && selection?.kind === "tile" && section}
  <MoveTileModal
    title={`Move “${title}”`}
    pages={movePages}
    currentPageId={selection.pageId}
    currentSectionId={selection.sectionId}
    onMove={moveTile}
    onClose={closeAll}
  />
{/if}

{#if moveSectionOpen && selection?.kind === "section"}
  <MoveSectionModal
    title={`Move “${title}”`}
    pages={registry.pages.map((entry) => ({
      id: entry.id,
      title: entry.title,
    }))}
    current={selection.pageId}
    onMove={moveSection}
    onClose={closeAll}
  />
{/if}

{#if addSectionOpen && kind === "empty"}
  <NameModal
    title="New section"
    label="Section name"
    validate={(value) => {
      if (!value) return "Enter a name";
      return sectionTitleTaken(page, value)
        ? "That name is already used"
        : null;
    }}
    onSubmit={createSection}
    onCancel={closeAll}
  />
{/if}
