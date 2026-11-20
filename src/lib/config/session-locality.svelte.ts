import { classifySession, type SessionClass } from "$lib/config/locality";
import { getSettings } from "$lib/stores/settings.svelte";

type LocalPage = { protocol: string; hostname: string };

/** This page's class: settings-driven, reactive through the settings store.
 *  No location (SSR/tests) is external, matching the old behaviour. */
export function sessionClass(where?: LocalPage | null): SessionClass {
  const page =
    where !== undefined
      ? where
      : (globalThis.location as LocalPage | undefined);
  if (!page) return { external: true, reason: "no-location" };
  return classifySession({
    protocol: page.protocol,
    hostname: page.hostname,
    settings: getSettings().externalSession,
  });
}

export function isLocalUi(where?: LocalPage | null): boolean {
  return !sessionClass(where).external;
}
