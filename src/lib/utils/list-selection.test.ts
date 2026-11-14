import { expect, it } from "vitest";
import { nextAfterRemoval } from "./list-selection";

const id = (item: string) => item;
const list = ["a", "b", "c"];

it("picks the next item after a deletion", () => {
  expect(nextAfterRemoval(list, "a", id)).toBe("b");
  expect(nextAfterRemoval(list, "b", id)).toBe("c");
});

it("picks the previous item when the deleted one was last", () => {
  expect(nextAfterRemoval(list, "c", id)).toBe("b");
});

it("has nothing to pick from an empty or unknown list", () => {
  expect(nextAfterRemoval(["a"], "a", id)).toBeUndefined();
  expect(nextAfterRemoval([], "a", id)).toBeUndefined();
  expect(nextAfterRemoval(list, "z", id)).toBeUndefined();
});
