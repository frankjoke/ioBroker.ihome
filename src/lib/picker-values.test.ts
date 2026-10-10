import { describe, it, expect, vi } from "vitest";

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: { emitAsync: vi.fn(), getState: vi.fn() },
}));

import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  fetchPickerValues,
  getPickerValue,
  isPickerFetched,
} from "$lib/picker-values.svelte.js";

describe("fetchPickerValues", () => {
  it("fetches raw via emitAsync and never touches the caching getState", async () => {
    (ioBroker.emitAsync as any).mockImplementation((_e: string, id: string) =>
      Promise.resolve(id === "a.0.one" ? { val: 1, ts: 123 } : undefined),
    );
    await fetchPickerValues(["a.0.one", "a.0.two"]);
    expect(ioBroker.emitAsync).toHaveBeenCalledWith("getState", "a.0.one");
    expect((ioBroker as any).getState).not.toHaveBeenCalled();
    expect(getPickerValue("a.0.one")).toEqual({ val: 1, ts: 123 });
    expect(isPickerFetched("a.0.one")).toBe(true);
    expect(isPickerFetched("a.0.two")).toBe(true);
  });

  it("does not abort the batch when one id fails", async () => {
    (ioBroker.emitAsync as any).mockImplementation((_e: string, id: string) =>
      id === "b.0.bad"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ val: 7, ts: 1 }),
    );
    await fetchPickerValues(["b.0.bad", "b.0.ok"]);
    expect(getPickerValue("b.0.ok")).toEqual({ val: 7, ts: 1 });
    expect(getPickerValue("b.0.bad")).toBeUndefined();
    expect(isPickerFetched("b.0.bad")).toBe(true);
  });
});
