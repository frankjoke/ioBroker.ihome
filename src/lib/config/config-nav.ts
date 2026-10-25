// The cog's session landing page. The first time a tab opens the configuration
// it lands on the User Interface page; after that the cog returns to the page
// that tab visited last.

export const CONFIG_LAST_KEY = "iHome.configPage";

export function cogTarget(stored: string | null, ids: string[]): string {
  return stored && ids.includes(stored) ? stored : "/ui";
}
