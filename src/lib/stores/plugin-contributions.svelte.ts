import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { unwrapPluginReply } from "$lib/config/plugin-call";
import {
  emptyPluginContributions,
  readPluginContributions,
  type PluginContributionSet,
  type Sourced,
} from "$lib/config/plugin-contributions";
import { getPluginsVersion } from "$lib/stores/plugins.svelte";

let all = $state<PluginContributionSet>(emptyPluginContributions());
let loadedVersion = -1;
let loading: Promise<void> | null = null;
let problem = $state("");

export function pluginContributionsProblem(): string {
  return problem;
}

/** Load once per plugin-list version; force reloads even when unchanged. */
export async function ensurePluginContributions(
  force = false,
): Promise<void> {
  const version = getPluginsVersion();
  if (!force && loadedVersion === version) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const reply = await ioBroker.sendTo(ioBroker.namespace, "plugins", {
        action: "contributions",
      });
      all = readPluginContributions(unwrapPluginReply(reply));
      problem = "";
      loadedVersion = version;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
      // Keep the previous set; the pickers keep working without this plugin.
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function visible(
  entries: Sourced<unknown>[],
  includeDisabled: boolean,
): Sourced<unknown>[] {
  return includeDisabled
    ? entries
    : entries.filter((entry) => entry.plugin.enabled);
}

export function getPluginContributions(
  includeDisabled = false,
): PluginContributionSet {
  if (includeDisabled) return all;
  return {
    tiles: visible(all.tiles, false) as PluginContributionSet["tiles"],
    bundles: visible(all.bundles, false) as PluginContributionSet["bundles"],
    logic: visible(all.logic, false) as PluginContributionSet["logic"],
    formulas: visible(all.formulas, false) as PluginContributionSet["formulas"],
    functions: visible(
      all.functions,
      false,
    ) as PluginContributionSet["functions"],
    snippets: visible(all.snippets, false) as PluginContributionSet["snippets"],
    problems: all.problems,
  };
}

export function getPluginContribution(
  key: string,
): Sourced<unknown> | undefined {
  for (const list of [
    all.tiles,
    all.bundles,
    all.logic,
    all.formulas,
    all.functions,
    all.snippets,
  ]) {
    const found = (list as Sourced<unknown>[]).find(
      (entry) => entry.key === key,
    );
    if (found) return found;
  }
  return undefined;
}

export function invalidatePluginContributions(): void {
  loadedVersion = -1;
}
