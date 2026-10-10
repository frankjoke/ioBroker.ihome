// Central reactive clock. `time.now` is a plain reactive value updated once a
// second; reading `time.now` inside a `$derived`/effect re-runs that
// computation on every tick. (A SvelteDate works too, but its getTime() is an
// internal derived that can become inert and stop updating — a plain $state
// value avoids that entirely.)
export const time = $state({ now: Date.now() });

if (typeof window !== "undefined")
  setInterval(() => {
    time.now = Date.now();
  }, 1000);
