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
