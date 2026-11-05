// Disables access to DOM typings like `HTMLElement` which are not available
// inside a service worker and instantiates the correct globals
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { base, build, files, prerendered, version } from "$service-worker";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import {
  notificationOptions,
  notificationTarget,
  notificationTitle,
  parsePushMessage,
} from "$lib/push-ops";

// Everything hashed may be precached; the shell (index.html) may not: a
// precached shell kept serving the previous build after an adapter update,
// until every tab of this origin had been closed — so every deploy needed a
// browser dance before it was visible.
const shell = base + "/";
const precache_list = [shell, ...build, ...files, ...prerendered]
  .filter((url) => url !== shell)
  .map((s) => ({ url: s, revision: version }));

precacheAndRoute(precache_list);
cleanupOutdatedCaches();

// A new worker takes over at once, so the next reload already serves the build
// that was just deployed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

// Navigations come from the network — the cache is only the offline fallback.
// `cache: "no-cache"` revalidates with the server (304 while unchanged): the
// ioBroker web adapter serves index.html with a max-age of its own, and without
// this the HTTP cache handed back the previous build even though the worker
// asked the network.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        const copy = response.clone();
        void caches
          .open("ihome-shell")
          .then((cache) => cache.put(shell, copy))
          .catch(() => {});
        return response;
      })
      .catch(async () => (await caches.match(shell)) || Response.error()),
  );
});

self.addEventListener("push", (event) => {
  let message = null;
  try {
    message = parsePushMessage(event.data?.json());
  } catch {
    message = null;
  }
  event.waitUntil(
    message
      ? self.registration.showNotification(
          notificationTitle(message),
          notificationOptions(message),
        )
      : // iOS may revoke a subscription after silent pushes; never drop one.
        self.registration.showNotification("iHome", {
          body: "New notification",
          data: { url: "" },
        }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = notificationTarget(
    event.notification.data?.url,
    self.registration.scope,
  );
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (client.url === target) {
          await client.focus();
          return;
        }
      }
      const client = windows[0];
      if (client) {
        await client.focus();
        if (typeof client.navigate === "function") {
          try {
            await client.navigate(target);
            return;
          } catch {
            // fall through to a new window
          }
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

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
