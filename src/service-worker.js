// Disables access to DOM typings like `HTMLElement` which are not available
// inside a service worker and instantiates the correct globals
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { base, build, files, prerendered, version } from "$service-worker";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

const precache_list = [base + "/", ...build, ...files, ...prerendered].map(
  (s) => ({
    url: s,
    revision: version,
  }),
);

precacheAndRoute(precache_list);
cleanupOutdatedCaches();

console.log("ServiceWorker", self);

async function getClientfromEvent(event) {
  const source = event?.source;
  if (!source) return null;
  return self.clients.get(source.id);
}

self.addEventListener("message", (event) => {
  event.waitUntil(
    (async () => {
      let { data, source, ports } = event;
      if (data?.type === "MESSAGE") {
        console.log(`Message from ${source.id}:`, data.payload);
        // Test: send back massage with added text
        const client = await getClientfromEvent(event);
        if (!client) return console.error(`could not get client ${source.id}`);
        client.postMessage({
          type: "MESSAGE",
          payload: "received and replied by ServiceWorker:" + data.payload,
        });
      } else {
        console.log(`unknown data from ${source.id}:`, data, ports);
      }
    })(),
  );
  // event.waitUntil(addFilesToCache());
});
