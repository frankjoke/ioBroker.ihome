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

type Match = "role" | "type" | null;

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

function typeFits(type: string, widget: FeatureDef["widget"]): boolean {
  if (type === "boolean") return widget === "switch" || widget === "button";
  if (type === "number") return widget === "level" || widget === "value";
  if (type === "string") return widget === "value" || widget === "enum";
  return false;
}

function matchFeature(feature: FeatureDef, object: any): Match {
  const role = String(object?.common?.role ?? "");
  if (roleMatches(role, feature.roleHints)) return "role";
  if (typeFits(String(object?.common?.type ?? ""), feature.widget))
    return "type";
  return null;
}

/** The nearest channel/folder ancestor, else the adapter instance. */
export function groupOfState(
  stateId: string,
  objects: Map<string, any>,
): string {
  const parts = String(stateId ?? "")
    .split(".")
    .filter(Boolean);
  if (parts.length < 3) return parts.slice(0, 2).join(".");
  for (let n = parts.length - 1; n >= 2; n--) {
    const id = parts.slice(0, n).join(".");
    const object = objects.get(id);
    if (object?.type === "channel" || object?.type === "folder") return id;
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

function candidatesFor(
  feature: FeatureDef,
  pool: TemplateReference[],
): TemplateReference[] {
  const role = pool.filter((entry) =>
    roleMatches(String(entry.object?.common?.role ?? ""), feature.roleHints),
  );
  if (role.length > 0) return role;
  const type = pool.filter((entry) =>
    typeFits(String(entry.object?.common?.type ?? ""), feature.widget),
  );
  return type.length === 1 ? type : [];
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
  const group = groupOfState(main.stateId, objects);
  const pool = groupStates(group, objects).filter(
    (entry) => entry.stateId !== main.stateId,
  );
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
    const candidates = candidatesFor(feature, pool);
    if (candidates.length === 1) {
      return {
        feature,
        ref: candidates[0].ref,
        stateId: candidates[0].stateId,
        object: candidates[0].object,
        candidates,
        ambiguous: false,
      };
    }
    return { feature, candidates, ambiguous: candidates.length > 1 };
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
    const entry = pool.find((item) => item.stateId === stateId) ?? {
      ref: stateId,
      stateId,
      object: groupFills[0].object,
    };
    for (const fill of groupFills) {
      fill.ref = undefined;
      fill.stateId = undefined;
      fill.object = undefined;
      fill.ambiguous = true;
      fill.candidates = [entry];
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
  return (hasRole ? scored.filter((entry) => entry.score >= 3) : scored).sort(
    (a, b) =>
      b.score - a.score || a.template.name.localeCompare(b.template.name),
  );
}
