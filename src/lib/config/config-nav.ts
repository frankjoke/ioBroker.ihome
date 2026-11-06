// The cog's session landing page. The first time a tab opens the configuration
// it lands on the User Interface page; after that the cog returns to the page
// that tab visited last.

export const CONFIG_LAST_KEY = "iHome.configPage";

export function cogTarget(stored: string | null, ids: string[]): string {
  // The cogs entry moved from the standalone formula page to Templates.
  const remembered = stored === "/formulas" ? "/templates" : stored;
  return remembered && ids.includes(remembered) ? remembered : "/ui";
}
