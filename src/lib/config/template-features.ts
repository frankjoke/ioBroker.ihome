import type { FeatureDef } from "$lib/config/features";

export function addFeature(
  features: FeatureDef[],
  feature: FeatureDef,
): FeatureDef[] {
  return [...features, { ...feature, primary: false }];
}

export function updateFeature(
  features: FeatureDef[],
  index: number,
  patch: Partial<FeatureDef>,
): FeatureDef[] {
  return features.map((feature, at) =>
    at === index ? { ...feature, ...patch } : feature,
  );
}

export function removeFeature(
  features: FeatureDef[],
  index: number,
): FeatureDef[] {
  return features.filter((_feature, at) => at !== index);
}

export function moveFeature(
  features: FeatureDef[],
  from: number,
  to: number,
): FeatureDef[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= features.length ||
    to >= features.length
  ) {
    return features;
  }
  const next = [...features];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function setPrimaryFeature(
  features: FeatureDef[],
  index: number,
): FeatureDef[] {
  return features.map((feature, at) => {
    const primary = at === index;
    return feature.primary === primary ? feature : { ...feature, primary };
  });
}
