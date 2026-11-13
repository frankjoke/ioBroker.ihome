/** Page-level help text, shown when a list page's header row is opened. */
export const DEVICES_GUIDE = `## What this page is for

A device is one thing iHome monitors and controls — a lamp, a thermostat, a
meter, a TV or a phone. It keeps the ioBroker states behind its controls and the
icon and type that tiles, logic and templates reuse.

**Functions**

- Create a device and bind its states as controls.
- See the live readings and the last update on each row.
- Filter by room and type, search, and sort the list.
- Open a row to edit its states, controls and history.

**Usages**

Lights, switches, blinds, thermostats, meters, media players, phones — anything
with an ioBroker state.

**Benefits**

One device definition feeds tiles, logic, history and templates. Change a state
or a label once and every view follows.`;

export const VARIABLES_GUIDE = `## What this page is for

A variable gives a friendly name to an ioBroker state, or holds a fixed value as
a constant. Formulas, logic and templates use the name instead of the raw state
id.

**Functions**

- Add a state variable and point it at an existing state, or create a new one.
- Add a constant for a fixed value that never changes.
- Filter by room, function and kind; search; sort the list.
- Open a row to edit its name, value type, unit, rooms/functions and notes.

**Usages**

A state variable wraps anything the broker carries — a sensor, a setpoint, a
device state. Constants hold thresholds, names or fixed numbers.

**Benefits**

One name is reused everywhere: a state can move or be renamed and the formulas
and logic that use the variable keep working.

Constants live only in iHome. A state variable names one ioBroker state — in
\`ihome.0.Variables\` or anywhere else, e.g. \`0_userdata.0\`. New states are
created when you save.`;

export const TEMPLATES_GUIDE = `## What this page is for

Templates are reusable definitions. Build one once, then apply it or insert it
instead of repeating the same device, logic or snippet.

**Code**

- **Formula** — the expression used by a device-control formula.
- **Function** — a reusable code snippet for formula, action or function fields.

Code templates are selected from their entry forms; they are not applied here.

**Templates**

- **Device** — a visual tile/control template applied to a device.
- **Logic** — a logic definition inserted into the logic document.
- **Both / API** — a logic plus a visual device, or the API states + logic +
  optional device flow.

**Benefits**

One definition is reused by devices, tiles, logic and formulas. Import and
export share a template as a JSON file; an applied copy stays independent.`;

export const LOGIC_GUIDE = `## What this page is for

Logics are the automations the adapter runs. A **Logic** reacts to switches,
sensors and timers; an **Action** computes a value. A logic without an external
output works inside the adapter only.

**Functions**

- Add a **Logic** and give it states, events and actions.
- Add an **Action** for a computed value or a reusable function.
- Start from a built-in logic with **From template**.
- Open a row to edit it; Save sits on its line.
- Show the adapter log, and filter by room or function.

**Usages**

Motion lights, timers, heating and blind automations, computed sensors and
values that other tiles or logics reuse.

**Benefits**

The same logic can read regular states, variables and other logics, and can
write states or memory. The editor validates the document before the adapter
runs it.`;
