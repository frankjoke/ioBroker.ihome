import type { LayoutSelection } from "$lib/config/layout-ops";

/** Actions the edit-mode context menu can offer. */
export type LayoutMenuId =
  | "edit"
  | "duplicate"
  | "move"
  | "delete"
  | "add-tile"
  | "add-section"
  | "add-page"
  | "delete-page";

export interface LayoutMenuEntry {
  id: LayoutMenuId;
  label: string;
  icon: string;
  danger?: boolean;
  disabled?: boolean;
}

export interface LayoutMenuContext {
  writable: boolean;
  hasSection: boolean;
  hasPage: boolean;
}

export type LayoutMenuTargetKind = "tile" | "section" | "empty";

/** What a selection means to the menu; a page has no actions of its own. */
export function layoutMenuTargetKind(
  selection: LayoutSelection | null,
): LayoutMenuTargetKind {
  if (selection?.kind === "tile") return "tile";
  if (selection?.kind === "section") return "section";
  return "empty";
}

/** The items the pointer menu shows for a tile, a section or empty space. */
export function layoutMenuItems(
  kind: LayoutMenuTargetKind,
  context: LayoutMenuContext,
): LayoutMenuEntry[] {
  const locked = !context.writable;
  if (kind === "tile") {
    return [
      { id: "edit", label: "Edit tile", icon: "edit" },
      {
        id: "duplicate",
        label: "Duplicate tile",
        icon: "content_copy",
        disabled: locked,
      },
      {
        id: "move",
        label: "Move to another section",
        icon: "drive_file_move",
        disabled: locked,
      },
      {
        id: "delete",
        label: "Delete tile",
        icon: "delete",
        danger: true,
        disabled: locked,
      },
    ];
  }
  if (kind === "section") {
    return [
      { id: "edit", label: "Edit section", icon: "edit" },
      {
        id: "add-tile",
        label: "Add tile",
        icon: "add",
        disabled: locked,
      },
      {
        id: "delete",
        label: "Delete section",
        icon: "delete",
        danger: true,
        disabled: locked,
      },
    ];
  }
  return [
    {
      id: "add-tile",
      label: "Add tile",
      icon: "add",
      disabled: locked || !context.hasSection,
    },
    {
      id: "add-section",
      label: "Add section",
      icon: "playlist_add",
      disabled: locked || !context.hasPage,
    },
    ...(context.hasPage
      ? [
          {
            id: "delete-page" as const,
            label: "Delete page",
            icon: "delete",
            danger: true,
            disabled: locked,
          },
        ]
      : [
          {
            id: "add-page" as const,
            label: "Add page",
            icon: "note_add",
            disabled: locked,
          },
        ]),
  ];
}
