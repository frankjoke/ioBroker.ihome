import { collectTileTemplate } from "$lib/config/tile-template";
import { visualTemplateProblem } from "$lib/config/visual-templates";
import type { SourceLook } from "$lib/config/slot-source";
import type { DeviceType } from "$lib/types/device";
import type { TemplateRegistry, TileConfig } from "$lib/types/display";

export interface SaveTileTemplateInput {
  id: string;
  name: string;
  type: DeviceType;
  hint?: string;
}

export interface SaveTileTemplatePlan {
  /** The registry to commit; absent when the plan was refused. */
  next?: TemplateRegistry;
  /** What was written, for the caller's note/toast. */
  note?: string;
  /** Why nothing was written. */
  error?: string;
}

/** The one save-as-template path: the tile editor and the eye-view menu both
 *  plan here, so a template saved from either place is identical. */
export function planSaveTileTemplate(
  registry: TemplateRegistry,
  config: TileConfig,
  look: SourceLook,
  input: SaveTileTemplateInput,
): SaveTileTemplatePlan {
  const templates = registry.templates ?? [];
  const wanted = input.name.trim().toLowerCase();
  if (
    templates.some(
      (template) =>
        String(template.name ?? "")
          .trim()
          .toLowerCase() === wanted,
    )
  ) {
    return { error: `A template named “${input.name}” already exists.` };
  }
  const result = collectTileTemplate(config, {
    id: input.id,
    name: input.name,
    type: input.type,
    look,
  });
  if (input.hint) result.template.stateHint = input.hint;
  if (!result.template.roles?.length) {
    return { error: "No slot in this tile could be bound to a role." };
  }
  const problem = visualTemplateProblem(
    result.template,
    templates.map((template) => template.id),
  );
  if (problem) return { error: problem };
  return {
    next: { ...registry, templates: [...templates, result.template] },
    note: `Saved “${input.name}”${
      result.omitted ? ` — ${result.omitted} slot(s) left out` : ""
    }.`,
  };
}
