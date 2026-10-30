import { localizeName, nameText } from "$lib/config/format";
import type { GlobalVariable } from "$lib/config/variables";

export interface StateRef {
  id: string;
  obj: any;
}

export interface StateNode {
  id: string;
  label: string;
  kind: "adapter" | "folder" | "state";
  obj?: any;
  children?: StateNode[];
}

export type FilterValue = string | string[] | undefined;

export interface StateFilters {
  adapter?: FilterValue;
  room?: FilterValue;
  functions?: FilterValue;
  type?: FilterValue;
  role?: FilterValue;
  search?: string;
}

function toList(v: FilterValue): string[] {
  if (v == null) return [];
  const list = Array.isArray(v) ? v : [v];
  return list.filter((x) => x !== "");
}

/** Name of a state's immediate parent folder (common.name or the id segment). */
export function parentName(objects: Map<string, any>, id: string): string {
  const parentId = id.split(".").slice(0, -1).join(".");
  if (!parentId) return "";
  const obj = objects.get(parentId);
  return localizeName(obj?.common?.name) || parentId.split(".").pop() || "";
}

/** Objects for the ancestor folders/channels of a state id (closest first). */
export function ancestorObjects(objects: Map<string, any>, id: string): any[] {
  const parts = id.split(".");
  const out: any[] = [];
  for (let n = parts.length - 1; n >= 2; n--) {
    const obj = objects.get(parts.slice(0, n).join("."));
    if (obj) out.push(obj);
  }
  return out;
}

/** Adapter instance id: the first two dot segments (e.g. "hue.0"). */
export function adapterOf(id: string): string {
  return id.split(".").slice(0, 2).join(".");
}

export function collectStates(objects: Map<string, any>): StateRef[] {
  const out: StateRef[] = [];
  for (const [key, obj] of objects.entries()) {
    if (!obj || obj.type !== "state") continue;
    const id = obj._id ?? key;
    if (id) out.push({ id, obj });
  }
  return out;
}

export function applyFilters(
  states: StateRef[],
  filters: StateFilters,
  roomsOf?: (id: string) => string[],
  functionsOf?: (id: string) => string[],
): StateRef[] {
  const adapters = toList(filters.adapter);
  const types = toList(filters.type);
  const roles = toList(filters.role);
  const roomSel = toList(filters.room);
  const functionSel = toList(filters.functions);
  return states.filter((s) => {
    const common = s.obj?.common ?? {};
    if (adapters.length && !adapters.includes(adapterOf(s.id))) return false;
    if (
      types.length &&
      !types.some((t) => String(common.type ?? "").includes(t))
    )
      return false;
    if (
      roles.length &&
      !roles.some((r) => String(common.role ?? "").includes(r))
    )
      return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const name = nameText(common.name).toLowerCase();
      if (!s.id.toLowerCase().includes(q) && !name.includes(q)) return false;
    }
    if (roomSel.length) {
      const r = roomsOf?.(s.id) ?? [];
      if (!roomSel.some((x) => r.includes(x))) return false;
    }
    if (functionSel.length) {
      const f = functionsOf?.(s.id) ?? [];
      if (!functionSel.some((x) => f.includes(x))) return false;
    }
    return true;
  });
}

export function buildStateTree(states: StateRef[]): StateNode[] {
  const byId = new Map<string, StateNode>();
  const roots: StateNode[] = [];

  const ensureNode = (
    id: string,
    label: string,
    kind: "adapter" | "folder",
    parent: StateNode | null,
  ): StateNode => {
    let node = byId.get(id);
    if (!node) {
      node = { id, label, kind, children: [] };
      byId.set(id, node);
      if (parent) parent.children!.push(node);
      else roots.push(node);
    }
    return node;
  };

  for (const s of states) {
    const parts = s.id.split(".");
    const adapterId = adapterOf(s.id);
    let parent = ensureNode(adapterId, adapterId, "adapter", null);
    for (let i = 2; i < parts.length - 1; i++) {
      const id = parts.slice(0, i + 1).join(".");
      parent = ensureNode(id, parts[i], "folder", parent);
    }
    const leaf: StateNode = {
      id: s.id,
      label: localizeName(s.obj?.common?.name) || parts[parts.length - 1],
      kind: "state",
      obj: s.obj,
    };
    parent.children!.push(leaf);
  }

  const sortRec = (nodes: StateNode[]) => {
    nodes.sort((a, b) => a.id.localeCompare(b.id));
    for (const n of nodes) if (n.children) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/**
 * The `_Variables` root of the state picker. Only state-kind variables appear:
 * a constant has no state to read or write. The leaf id is the bare variable
 * name — the reference the alias layer resolves — while `obj` is the real
 * state's object, so the leaf shows that state's role/unit/write and its live
 * value. A variable whose state is not in the cache becomes a read-only,
 * synthesized object (still pickable, and it shows "unavailable" until a value
 * arrives).
 */
export function buildVariableNode(
  variables: GlobalVariable[],
  objects: Map<string, any>,
): StateNode | null {
  const children: StateNode[] = [];
  for (const v of variables) {
    if (v.kind !== "state" || !v.stateId) continue;
    const real = objects.get(v.stateId);
    children.push({
      id: v.name,
      label: v.name,
      kind: "state",
      obj: real ?? {
        _id: v.stateId,
        common: {
          name: v.name,
          type: v.type,
          role: v.role,
          unit: v.unit,
          write: false,
        },
      },
    });
  }
  if (!children.length) return null;
  children.sort((a, b) => a.id.localeCompare(b.id));
  return { id: "_Variables", label: "_Variables", kind: "adapter", children };
}

/**
 * Stable, unique key for a tree node. A state leaf and a folder can share the
 * same path (a state id that is also a folder prefix), so the key must include
 * the kind.
 */
export function nodeKey(node: StateNode): string {
  return `${node.kind}:${node.id}`;
}

/** State leaves currently visible (under expanded branches), capped at `limit`.
 *  The id is the state to fetch: a variable leaf's selected id is its bare
 *  name, but its value lives in the real state named by `obj._id`. */
export function collectVisibleLeaves(
  nodes: StateNode[],
  expanded: { has(id: string): boolean },
  limit = 200,
): string[] {
  const out: string[] = [];
  const walk = (list: StateNode[]) => {
    for (const node of list) {
      if (out.length >= limit) return;
      if (node.kind === "state") {
        out.push(node.obj?._id ?? node.id);
      } else if (expanded.has(node.id) && node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}
