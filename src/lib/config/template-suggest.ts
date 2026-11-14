import type { FeatureDef } from "$lib/config/features";
import type { Template } from "$lib/types/display";
import { primaryFeature, templateFeatures } from "./template-ops";
import type { TemplateReference } from "./template-reference";

export interface FeatureCandidate {
  feature: FeatureDef;
  /** The stored reference (state id or variable name). */
  ref?: string;
  stateId?: string;
  object?: any;
  candidates: TemplateReference[];
  ambiguous: boolean;
  /** Two features resolved to the same state; the user must choose one. */
  conflict?: boolean;
}

export interface AutoFillResult {
  fills: FeatureCandidate[];
  missingRequired: string[];
  conflicts: string[];
}

export interface TemplateSuggestion {
  template: Template;
  feature: FeatureDef;
  score: number;
}

type Match = "role" | "generic" | "type" | null;

/** Hints so broad that they say nothing about the device family. */
const GENERIC_HINTS = new Set(["value", "state"]);

/** Adapter bookkeeping states that are never a device control. */
const INFRASTRUCTURE_LEAVES = new Set([
  "device_query",
  "send_payload",
  "msg_from_zigbee",
  "link_quality",
  "restart_device",
  "identify",
  "trigger_indicator",
  "enabled",
  "switch.enable",
  "Event",
  "ChannelName",
  "clientId",
  "rpcNotifications",
  "statusNotifications",
  "topicPrefix",
  "debugEnabled",
  "eco",
  "sntp",
  "timezone",
  "apEnabled",
  "authEnabled",
  "firmware",
  "firmwareupdate",
  "attributeList",
  "acceptedCommandList",
  "generatedCommandList",
  "featureMap",
  "clusterRevision",
  "supportedFeatures",
  "serverList",
  "clientList",
  "partsList",
  "deviceTypeList",
]);

function isInfrastructure(entry: TemplateReference): boolean {
  const leaf =
    String(entry.stateId ?? "")
      .split(".")
      .pop() ?? "";
  return INFRASTRUCTURE_LEAVES.has(leaf);
}

function roleMatches(role: string, hints: string[]): boolean {
  const value = role.trim().toLowerCase();
  if (!value) return false;
  return hints.some((raw) => {
    const hint = raw.trim().toLowerCase();
    if (!hint) return false;
    if (value === hint) return true;
    if (hint.includes(".") && value.endsWith(`.${hint}`)) return true;
    if (!hint.includes(".") && value.startsWith(`${hint}.`)) return true;
    return false;
  });
}

function specificRoleMatches(role: string, hints: string[]): boolean {
  return hints.some(
    (hint) =>
      !GENERIC_HINTS.has(hint.trim().toLowerCase()) &&
      roleMatches(role, [hint]),
  );
}

function typeFits(type: string, widget: FeatureDef["widget"]): boolean {
  if (type === "boolean") return widget === "switch" || widget === "button";
  if (type === "number") return widget === "level" || widget === "value";
  if (type === "string") return widget === "value" || widget === "enum";
  return false;
}

function matchFeature(feature: FeatureDef, object: any): Match {
  const role = String(object?.common?.role ?? "");
  if (specificRoleMatches(role, feature.roleHints)) return "role";
  if (roleMatches(role, feature.roleHints)) return "generic";
  if (
    typeFits(String(object?.common?.type ?? ""), feature.widget) &&
    feature.roleHints.includes(feature.widget)
  ) {
    return "type";
  }
  return null;
}

/** How well an object's role fits a feature: role 3, generic role 2, type 1. */
export function featureMatchRank(feature: FeatureDef, object: any): number {
  const match = matchFeature(feature, object);
  return match === "role"
    ? 3
    : match === "generic"
      ? 2
      : match === "type"
        ? 1
        : 0;
}

/** The state ids an alias object points at (`common.alias.id`). */
export function aliasBaseIds(object: any): string[] {
  const alias = object?.common?.alias;
  if (!alias) return [];
  const value = alias.id ?? alias.read ?? alias.write;
  return (Array.isArray(value) ? value : [value]).filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.includes("."),
  );
}

/** The nearest channel/folder ancestor, else the adapter instance. With
 *  `includeDevice`, a real ioBroker device object also ends the walk — used
 *  when following an alias base, whose parent is often the device. */
export function groupOfState(
  stateId: string,
  objects: Map<string, any>,
  includeDevice = false,
): string {
  const parts = String(stateId ?? "")
    .split(".")
    .filter(Boolean);
  if (parts.length < 3) return parts.slice(0, 2).join(".");
  for (let n = parts.length - 1; n >= 2; n--) {
    const id = parts.slice(0, n).join(".");
    const object = objects.get(id);
    if (
      object?.type === "channel" ||
      object?.type === "folder" ||
      (includeDevice && object?.type === "device")
    ) {
      return id;
    }
  }
  return parts.slice(0, 2).join(".");
}

function groupStates(
  groupId: string,
  objects: Map<string, any>,
): TemplateReference[] {
  const prefix = `${groupId}.`;
  const out: TemplateReference[] = [];
  for (const [id, object] of objects.entries()) {
    if (object?.type !== "state" || !id.startsWith(prefix)) continue;
    out.push({ ref: id, stateId: id, object });
  }
  return out;
}

/** The nearest device object, else the adapter instance (a channel group's
 *  parent device carries availability/battery states). */
function deviceGroupOfState(
  stateId: string,
  objects: Map<string, any>,
): string {
  const parts = String(stateId ?? "")
    .split(".")
    .filter(Boolean);
  if (parts.length < 3) return parts.slice(0, 2).join(".");
  for (let n = parts.length - 1; n >= 2; n--) {
    const id = parts.slice(0, n).join(".");
    if (objects.get(id)?.type === "device") return id;
  }
  return parts.slice(0, 2).join(".");
}

/** Match the remaining template features against the main state's group. */
export function autoFillTemplate(
  template: Template,
  main: TemplateReference,
  objects: Map<string, any>,
  anchorFeature?: string,
): AutoFillResult {
  const features = templateFeatures(template);
  const anchor =
    features.find((feature) => feature.feature === anchorFeature) ??
    primaryFeature(features);
  const bases = aliasBaseIds(main.object);
  const aliasGroup = groupOfState(main.stateId, objects);
  const baseGroups = bases
    .map((id) => groupOfState(id, objects, true))
    .filter((id) => id !== aliasGroup);
  const exclude = new Set([main.stateId, ...bases]);
  const basePool = [
    ...new Set(baseGroups.flatMap((group) => groupStates(group, objects))),
  ].filter((entry) => !exclude.has(entry.stateId) && !isInfrastructure(entry));
  const aliasPool = groupStates(aliasGroup, objects).filter(
    (entry) => !exclude.has(entry.stateId) && !isInfrastructure(entry),
  );
  const deviceGroup = deviceGroupOfState(main.stateId, objects);
  const devicePool =
    deviceGroup !== aliasGroup
      ? groupStates(deviceGroup, objects).filter(
          (entry) => !exclude.has(entry.stateId) && !isInfrastructure(entry),
        )
      : [];
  const pools = basePool.length > 0 ? [basePool, aliasPool] : [aliasPool];
  const GLOBAL_FEATURES = new Set(["connected", "battery"]);

  function matching(
    feature: FeatureDef,
    predicate: (entry: TemplateReference) => boolean,
  ): TemplateReference[] {
    for (const pool of pools) {
      const hit = pool.filter(predicate);
      if (hit.length > 0) return hit;
    }
    // A channel group (Shelly Relay0) does not carry the device-wide
    // availability/battery states; fall back to the parent device for those.
    if (
      devicePool.length > 0 &&
      (GLOBAL_FEATURES.has(feature.feature) ||
        feature.roleHints.some(
          (hint) => hint.startsWith("indicator.") || hint.includes("battery"),
        ))
    ) {
      return devicePool.filter(predicate);
    }
    return [];
  }

  const roleCandidates = new Map<FeatureDef, TemplateReference[]>();
  const claimed = new Set<string>();
  for (const feature of features) {
    if (feature === anchor) continue;
    const candidates = matching(feature, (entry) =>
      specificRoleMatches(
        String(entry.object?.common?.role ?? ""),
        feature.roleHints,
      ),
    );
    roleCandidates.set(feature, candidates);
    for (const candidate of candidates) claimed.add(candidate.stateId);
  }
  const fills: FeatureCandidate[] = features.map((feature) => {
    if (feature === anchor) {
      return {
        feature,
        ref: main.ref,
        stateId: main.stateId,
        object: main.object,
        candidates: [main],
        ambiguous: false,
      };
    }
    const roles = roleCandidates.get(feature) ?? [];
    if (roles.length === 1) {
      return {
        feature,
        ref: roles[0].ref,
        stateId: roles[0].stateId,
        object: roles[0].object,
        candidates: roles,
        ambiguous: false,
      };
    }
    if (roles.length > 1) {
      return { feature, candidates: roles, ambiguous: true };
    }
    const type = matching(
      feature,
      (entry) =>
        !claimed.has(entry.stateId) &&
        feature.roleHints.includes(feature.widget) &&
        typeFits(String(entry.object?.common?.type ?? ""), feature.widget),
    );
    if (type.length === 1) {
      return {
        feature,
        ref: type[0].ref,
        stateId: type[0].stateId,
        object: type[0].object,
        candidates: type,
        ambiguous: false,
      };
    }
    return { feature, candidates: type, ambiguous: type.length > 1 };
  });

  const conflicts: string[] = [];
  const byState = new Map<string, FeatureCandidate[]>();
  for (const fill of fills) {
    if (!fill.stateId) continue;
    const list = byState.get(fill.stateId) ?? [];
    list.push(fill);
    byState.set(fill.stateId, list);
  }
  for (const [stateId, groupFills] of byState) {
    if (groupFills.length < 2) continue;
    const entry = pools.flat().find((item) => item.stateId === stateId) ?? {
      ref: stateId,
      stateId,
      object: groupFills[0].object,
    };
    for (const fill of groupFills) {
      fill.ref = undefined;
      fill.stateId = undefined;
      fill.object = undefined;
      fill.ambiguous = true;
      fill.conflict = true;
      fill.candidates = fill.candidates.length > 0 ? fill.candidates : [entry];
      conflicts.push(fill.feature.feature);
    }
  }

  return {
    fills,
    missingRequired: features
      .filter(
        (feature) =>
          feature.required &&
          !fills.find(
            (fill) => fill.feature === feature && fill.stateId !== undefined,
          ),
      )
      .map((feature) => feature.feature),
    conflicts,
  };
}

/** Templates whose features fit a picked state, best match first. */
export function suggestTemplatesForState(
  state: { stateId: string; object: any },
  templates: Template[],
): TemplateSuggestion[] {
  if (
    isInfrastructure({
      ref: state.stateId,
      stateId: state.stateId,
      object: state.object,
    })
  ) {
    return [];
  }
  const scored: TemplateSuggestion[] = [];
  for (const template of templates) {
    let best: TemplateSuggestion | undefined;
    for (const feature of templateFeatures(template)) {
      const match = matchFeature(feature, state.object);
      if (!match) continue;
      const score = (match === "role" ? 3 : 1) + (feature.primary ? 1 : 0);
      if (!best || score > best.score) {
        best = { template, feature, score };
      }
    }
    if (best) scored.push(best);
  }
  const hasRole = scored.some((entry) => entry.score >= 3);
  const list = hasRole ? scored.filter((entry) => entry.score >= 3) : scored;
  return list.sort(
    (a, b) =>
      b.score - a.score ||
      templateFeatures(a.template).length -
        templateFeatures(b.template).length ||
      a.template.name.localeCompare(b.template.name),
  );
}
