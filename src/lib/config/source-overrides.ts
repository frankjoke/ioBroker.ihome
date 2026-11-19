import { num, parseDoc } from "$lib/config/doc-parse";
import { localizeName } from "$lib/config/format";
import { applyRead } from "$lib/utils/transform";
import {
  type GlobalVariable,
  convertValue,
  resolveVariable,
  stateIdFor,
} from "$lib/config/variables";
import {
  buildScope,
  evaluateVirtual,
  roundValue,
  sanitizeLabel,
  type PoolEntry,
} from "$lib/config/virtual-ops";
import {
  aliasBaseIds,
  deviceGroupOfState,
  groupOfState,
  groupStates,
} from "$lib/config/template-suggest";
import { isOnline, stateIdsInExpression, truthy } from "$lib/config/rule-ops";
import { newId } from "$lib/utils/ids";
import type { OverrideRegistry, SourceOverride } from "$lib/types/overrides";

/** The config document every override lives in. */
export const OVERRIDE_LIST_ID = "ihome.0.config.overrideList";

export function emptyOverrideRegistry(): OverrideRegistry {
  return { version: 1, updatedAt: 0, overrides: [] };
}

/** One stored entry, or null when it cannot be a usable override. */
function normalizeOverride(value: unknown): SourceOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const stateId = typeof raw.stateId === "string" ? raw.stateId.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const kind =
    raw.kind === "repair" || raw.kind === "derived" ? raw.kind : null;
  if (!id || !stateId || !name || !kind) return null;
  // Unknown optional fields are kept: a newer iHome may have written them.
  return { ...raw, id, stateId, name, kind } as SourceOverride;
}

/**
 * Arbitrary persisted data as a registry, or null when the document is
 * unreadable (the UI then stays read-only and never overwrites it).
 */
export function normalizeOverrideRegistry(
  value: unknown,
): OverrideRegistry | null {
  return parseDoc(value, (doc) => {
    if (!Array.isArray(doc.overrides)) return null;
    const overrides = doc.overrides
      .map(normalizeOverride)
      .filter((o): o is SourceOverride => o !== null);
    // A non-empty list that loses every entry is corrupt, not an empty registry.
    if (doc.overrides.length > 0 && overrides.length === 0) return null;
    return {
      version: 1,
      updatedAt: num(doc.updatedAt, 0),
      ...(doc.migratedDevices === true ? { migratedDevices: true } : {}),
      overrides,
    };
  });
}

export function overrideById(
  reg: OverrideRegistry,
  id: string,
): SourceOverride | undefined {
  return reg.overrides.find((o) => o.id === id);
}

export function overridesForState(
  reg: OverrideRegistry,
  stateId: string,
  variables: GlobalVariable[] = [],
): SourceOverride[] {
  const wanted = stateIdFor(stateId, variables);
  return reg.overrides.filter(
    (o) => stateIdFor(o.stateId, variables) === wanted,
  );
}

/** Name uniqueness applies per state, case-insensitive. A state id may be a
 *  variable name; both sides are resolved before they are compared. */
export function overrideNameTaken(
  reg: OverrideRegistry,
  stateId: string,
  name: string,
  exceptId?: string,
  variables: GlobalVariable[] = [],
): boolean {
  const key = String(name ?? "")
    .trim()
    .toLowerCase();
  if (!key) return false;
  const wanted = stateIdFor(stateId, variables);
  return reg.overrides.some(
    (o) =>
      o.id !== exceptId &&
      stateIdFor(o.stateId, variables) === wanted &&
      o.name.trim().toLowerCase() === key,
  );
}

/** Replace by id, append otherwise; `updatedAt` belongs to the store. */
export function upsertOverride(
  reg: OverrideRegistry,
  override: SourceOverride,
): OverrideRegistry {
  const exists = reg.overrides.some((o) => o.id === override.id);
  return {
    ...reg,
    overrides: exists
      ? reg.overrides.map((o) => (o.id === override.id ? override : o))
      : [...reg.overrides, override],
  };
}

export function removeOverride(
  reg: OverrideRegistry,
  id: string,
): OverrideRegistry {
  return { ...reg, overrides: reg.overrides.filter((o) => o.id !== id) };
}

/** The override a template's repair stands for on a state: same role first,
 *  then the same name. Only a repair is reusable — a derived value is not. */
export function matchingOverride(
  overrides: SourceOverride[],
  stateId: string,
  repair: { name?: string; role?: string },
  variables: GlobalVariable[] = [],
): SourceOverride | undefined {
  const wanted = stateIdFor(stateId, variables);
  const own = overrides.filter(
    (o) => o.kind === "repair" && stateIdFor(o.stateId, variables) === wanted,
  );
  const role = String(repair.role ?? "")
    .trim()
    .toLowerCase();
  if (role) {
    const hit = own.find(
      (o) =>
        String(o.role ?? "")
          .trim()
          .toLowerCase() === role,
    );
    if (hit) return hit;
  }
  const name = String(repair.name ?? "")
    .trim()
    .toLowerCase();
  if (name) {
    return own.find((o) => o.name.trim().toLowerCase() === name);
  }
  return undefined;
}

/**
 * The override a template repair applies to a state: the existing one wins,
 * otherwise the repair is created with a name unique on that state. Returns
 * the registry to commit and the id the slots bind.
 */
export function ensureRepairOverride(
  reg: OverrideRegistry,
  stateId: string,
  repair: Omit<SourceOverride, "id" | "stateId">,
  variables: GlobalVariable[] = [],
): { registry: OverrideRegistry; id: string } {
  const existing = matchingOverride(reg.overrides, stateId, repair, variables);
  if (existing) return { registry: reg, id: existing.id };
  const names = new Set(
    overridesForState(reg, stateId, variables).map((o) =>
      o.name.trim().toLowerCase(),
    ),
  );
  let name = repair.name;
  let i = 2;
  while (names.has(name.trim().toLowerCase())) name = `${repair.name}${i++}`;
  const override: SourceOverride = {
    ...repair,
    name,
    id: newId(),
    stateId,
  };
  return { registry: upsertOverride(reg, override), id: override.id };
}

/** The siblings a derived expression can name with `$.`. */
export interface OverrideGroup {
  /** Sanitized name → the state it reads, and the override it resolves through. */
  names: Map<string, { stateId: string; override?: string }>;
  stateIds: string[];
}

/** A state's raw expression name: its `common.name`, else its leaf id. */
function stateLabel(object: any, stateId: string): string {
  const name = localizeName(object?.common?.name).trim();
  return name || String(stateId).split(".").pop() || stateId;
}

/**
 * The anchor's siblings, in the same order the template auto-fill uses: the
 * anchor and its alias bases, the alias base group, the alias group, then the
 * device group. Overrides are added first, so an override name wins over a raw
 * sibling with that name (the raw state stays reachable via `get("<id>")`).
 */
export function overrideGroup(
  stateId: string,
  objects: Map<string, any>,
  registry: OverrideRegistry,
  variables: GlobalVariable[] = [],
): OverrideGroup {
  const target = resolveVariable(stateId, variables);
  const anchor =
    target?.kind === "state" && target.stateId ? target.stateId : stateId;
  const bases = aliasBaseIds(objects.get(anchor));
  const aliasGroup = groupOfState(anchor, objects);
  const baseGroups = bases.map((id) => groupOfState(id, objects, true));
  const deviceGroup = deviceGroupOfState(anchor, objects);
  const stateIds = [
    ...new Set([
      anchor,
      ...bases,
      ...baseGroups.flatMap((group) =>
        groupStates(group, objects).map((entry) => entry.stateId),
      ),
      ...groupStates(aliasGroup, objects).map((entry) => entry.stateId),
      ...groupStates(deviceGroup, objects).map((entry) => entry.stateId),
    ]),
  ];

  const names: OverrideGroup["names"] = new Map();
  const taken = new Set<string>();
  const claimed = new Set<string>();
  for (const id of stateIds) {
    for (const override of overridesForState(registry, id, variables)) {
      const name = sanitizeLabel(override.name, taken);
      claimed.add(sanitizeLabel(override.name, new Set()));
      names.set(name, { stateId: id, override: override.id });
    }
  }
  for (const id of stateIds) {
    const label = stateLabel(objects.get(id), id);
    if (claimed.has(sanitizeLabel(label, new Set()))) continue;
    names.set(sanitizeLabel(label, taken), { stateId: id });
  }
  return { names, stateIds };
}

/**
 * The `$.name` identifiers an expression reads, in order, unique. Bracket
 * access (`$["name"]`) still evaluates but is not captured as an input — the
 * editor writes dot access.
 */
function dollarNames(expr: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\$\.([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(String(expr ?? "")))) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      out.push(match[1]);
    }
  }
  return out;
}

/**
 * A repair declares the state's real scalar type; a derived expression must
 * read the same corrected value the slot renders ("12" as the number 12).
 * Undeclared or unparseable values pass through.
 */
function declaredValue(value: unknown, type: string | undefined): unknown {
  if (type !== "number" && type !== "boolean") return value;
  const { value: out, error } = convertValue(String(value), type);
  return error ? value : out;
}

/**
 * Evaluate a derived override against its group. `$.name` reads a sibling's
 * live value through a repair override's read transform; a name the group does
 * not know is an error, never a silent `undefined`, and v1 refuses to chain
 * derived overrides (a derived sibling would need ordering/recursion, so it
 * throws instead). `get("<id>")` reads anything the caller subscribed.
 */
export function evaluateOverride(
  override: SourceOverride,
  ctx: {
    group: OverrideGroup;
    states: Map<string, any>;
    registry: OverrideRegistry;
    objects: Map<string, any>;
  },
): { value?: unknown; error?: string; inputs: string[] } {
  const expr = override.expr ?? "";
  const valueOf = (id: string) => ctx.states.get(id)?.val;
  const siblings: Record<string, unknown> = {};
  for (const [name, entry] of ctx.group.names) {
    const repair = entry.override
      ? overrideById(ctx.registry, entry.override)
      : undefined;
    if (repair?.kind === "derived") {
      Object.defineProperty(siblings, name, {
        enumerable: true,
        get() {
          throw new Error(`derived override "${name}" is not readable`);
        },
      });
      continue;
    }
    siblings[name] = repair
      ? declaredValue(
          applyRead(valueOf(entry.stateId), repair.transform),
          repair.type ??
            String(ctx.objects.get(entry.stateId)?.common?.type ?? ""),
        )
      : valueOf(entry.stateId);
  }

  const inputs: string[] = [];
  const seen = new Set<string>();
  for (const name of dollarNames(expr)) {
    const stateId = ctx.group.names.get(name)?.stateId;
    if (stateId && !seen.has(stateId)) {
      seen.add(stateId);
      inputs.push(stateId);
    }
  }
  for (const stateId of stateIdsInExpression(expr)) {
    if (!seen.has(stateId)) {
      seen.add(stateId);
      inputs.push(stateId);
    }
  }

  const pool: PoolEntry[] = [
    ...new Set([...ctx.group.stateIds, ...inputs]),
  ].map((id) => ({ stateId: id, value: valueOf(id) }));
  const scope = buildScope([], pool);
  // A Proxy turns a typo into an error instead of `undefined` arithmetic.
  scope.locals.$ = new Proxy(siblings, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !(prop in target)) {
        throw new Error(`unknown sibling "${prop}"`);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  scope.helpers = { ...scope.helpers, truthy, isOnline };
  const { value, error } = evaluateVirtual(expr, scope);
  if (error) return { value: undefined, error, inputs };
  return { value: roundValue(value, override.precision), inputs };
}
