import type { Control } from "$lib/types/device";

/** Switch a control between a state-backed control and a virtual control. */
export function switchControlKind(
  control: Control,
  kind: "state" | "virtual",
): Control {
  if (kind === "virtual") {
    return {
      ...control,
      kind: "virtual",
      writable: false,
      stateId: undefined,
      transform: undefined,
      virtual: control.virtual ?? { expr: "" },
    };
  }
  return { ...control, kind: undefined, virtual: undefined, writable: true };
}
