import { expect, it } from "vitest";
import { pinCacheFor, withPinCache } from "./pin-cache";

it("keeps each instance's pin cache separate", () => {
  const cache = withPinCache({}, "ihome.0", { pin: "1111", lockPencil: true });
  const next = withPinCache(cache, "ihome.1", { pin: "2222" });
  expect(pinCacheFor(next, "ihome.0")).toEqual({
    pin: "1111",
    lockPencil: true,
  });
  expect(pinCacheFor(next, "ihome.1")).toEqual({ pin: "2222" });
  expect(pinCacheFor(next, "ihome.2")).toEqual({});
});
