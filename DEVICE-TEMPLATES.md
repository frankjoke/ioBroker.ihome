# Device templates

A **device template** describes a JSON device once and generates:

- the state objects it exposes,
- one normal logic that reads the device and (for HTTP templates) writes
  changed values back,
- optionally, a device entry with controls filled from `itemList`.

The generated states and logic are **unlinked copies**. Editing the template
later does not touch existing devices; the template stays available for another
device. Applying a template again creates another uniquely named logic (and
updates only state objects whose properties actually changed).

> Current UI: **Logic → Device templates**. The apply form has an optional
> **Device name**; when filled, a device is created with controls. The library
> itself is not yet under Devices.

## 1. Template object

A template is JavaScript object source, not JSON, because it contains
functions. It is stored as text and evaluated when applied.

```js
({
  // optional: "http" (default) or "state"
  readFrom: "http",
  // optional: known device type, default "Custom"
  deviceType: "Switch",

  params: [
    { name: "baseUrl", label: "Base URL", type: "string",
      description: "e.g. http://192.168.1.50:8099" },
    { name: "token", label: "Token", type: "state",
      description: "State whose value is sent as the Bearer token." },
    { name: "poll", label: "Poll interval", type: "duration", default: "30s",
      description: "How often to read; e.g. 30s, 5m, 1h." },
  ],

  itemList: [
    {
      name: "power",
      label: "Power",
      type: "boolean",
      role: "switch",
      source: "data.power",
      foreignWriteName: "power",
      conversion: (result, raw) => raw === true || raw === "1",
      setConversion: (value) => (value ? "1" : "0"),
    },
  ],

  readRequest(params) {
    return {
      url: params.baseUrl + "/status",
      options: {
        headers: { authorization: "Bearer " + params.token },
      },
    };
  },

  writeRequest(value, item, params) {
    return {
      url:
        params.baseUrl +
        "/set?" +
        item.foreignWriteName +
        "=" +
        encodeURIComponent(item.setConversion(value)),
    };
  },
});
```

### `params`

Each entry is `{ name, label, type, default?, description? }`.

| `type` | Meaning |
| --- | --- |
| `string` | Text; embedded in the generated logic. |
| `number` | Number; embedded. |
| `boolean` | Checkbox; embedded. |
| `duration` | Duration text such as `30s`, `5m`, `1h`; used as the poll interval. |
| `state` | A state id chosen in the apply form. The generated logic reads its **value at runtime**, so tokens are not embedded in the logic document. |

- `description` is optional help text shown under the field in the apply form.
- `baseState` is reserved and must not be a parameter name.
- A `poll` parameter is the timer interval for HTTP templates; default `30s`.
- Parameter names are currently not identifier-checked; avoid dots, `__proto__`
  and other non-identifier names.

### `itemList`

Each item describes one generated state and its read/write mapping.

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | State name below the base destination; also the machine input name. `[A-Za-z0-9_-]+`, not `$…`, not `poll`, unique. |
| `label` | no | Object name; defaults to `name`. |
| `type` | yes | `boolean`, `number`, `string`, `object`. |
| `role` | no | `common.role`; default `state`. `object` items always use `json`. |
| `unit` | no | `common.unit` for number states. |
| `states` | no | `common.states` labels; object or JSON string. |
| `min`, `max`, `step` | no | Number state limits. |
| `readOnly` | no | `false` default. When true the state is `write: false` and gets no write row. |
| `initial` | no | Initial value; defaults `false`, `0`, `""`, `"{}"`. |
| `source` | no | Where the value sits in the read result. A string is split on dots (`"data.power"`). An array uses exact keys (`["1.8.0"]`), so JSON keys containing dots work. Omitted = the whole result. |
| `feature` | no | Device feature name (`power`, `energy`, `voltage`, …). Derived from `role`/`type` when omitted. |
| `hidden` | no | Hide the generated device control; the state still exists. |
| `updateAlways` | no | Read: write even when equal (`forward: "always"`). Write: trigger even when the value is unchanged (`edge: "any"`). |
| `ack` | no | Ack for the read write; default `true`. `false` on a writable item is rejected because it would loop. |
| `foreignWriteName` | writable items | API parameter name used by `writeRequest`. |
| `conversion` | no | `(result, raw) => value`; synchronous and pure. |
| `setConversion` | no | `(value) => foreignValue`; synchronous and pure. |

`type: "object"` is stored as `common.type: "string"` with `role: "json"` and a
JSON text value. The generated read serializes objects with `JSON.stringify`;
a string is treated as already serialized.

### Request functions

- `readRequest(params)` returns `{ url, options? }`.
- `writeRequest(value, item, params)` returns `{ url, options? }`.
- `options` is passed to `fetchJson`: `method`, `headers`, `body`.
- Both functions must be **synchronous and pure**. They must not call
  `fetch`, `set`, or read states themselves; the generated logic performs the
  I/O. `async` functions are rejected by validation.
- `conversion` and `setConversion` are also synchronous and pure.

## 2. State-source templates (`readFrom: "state"`)

Instead of polling HTTP, a template can listen to one state and parse its
value. This is the mode for MQTT, another adapter, or another logic’s output.

```js
({
  readFrom: "state",
  params: [
    { name: "source", label: "Source state", type: "state",
      description: "e.g. mqtt.0.SHRDZM...sensor" },
  ],
  itemList: [
    {
      name: "energy_total",
      label: "Energy total",
      type: "number",
      role: "value.energy",
      unit: "kWh",
      source: ["1.8.0"],
      readOnly: true,
      conversion: (result, raw) => Number(raw) / 1000,
    },
    {
      name: "power",
      label: "Power",
      type: "number",
      role: "value.power",
      unit: "W",
      source: ["1.7.0"],
      readOnly: true,
      conversion: (result, raw) => Number(raw),
    },
  ],
});
```

Rules:

- A parameter named `source` of type `state` is required.
- Every item must be `readOnly: true`.
- `readRequest` and `writeRequest` are optional and unused.
- The source state value may be a JSON **string** or an already-parsed object.
  A string is parsed with `JSON.parse`; a parse error logs and skips that update.
- The generated machine has **no timer and no write rows**. It listens to the
  source state and writes the generated states with `ack: true`.
- The source state can be an MQTT state, another adapter’s state, or an
  `ihome.0.Logic.<id>` output. A memory value is not a state and needs a state
  bridge.

### Dotted keys

`source: "1.8.0"` means `result["1"]["8"]["0"]` and will not find a key named
`"1.8.0"`. Use `source: ["1.8.0"]` for exact keys. This is the case for OBIS
electricity-meter keys:

```json
{
  "timestamp": "2026-11-06T20:44:30",
  "1.8.0": "21557698",
  "1.7.0": "388",
  "32.7.0": "230.90"
}
```

```js
source: ["1.8.0"]   // 21557698
source: "1.8.0"     // undefined
```

## 3. Applying a template

1. Open **Logic → Device templates**.
2. Select a built-in template or a saved user template.
3. **Apply**. For a user template, Apply saves the current name, description and
   source first; an invalid definition is not applied.
4. Choose:
   - **Base state**: the prefix for generated states, e.g.
     `ihome.0.Variables.ElectricityMeter`. It must start with the adapter
     namespace and must not use `Logic`, `config`, `info`, `phone`, `system`
     or `enum`.
   - **Device name** (optional): when filled, a device entry is created with
     controls from `itemList`; when empty, only states and the logic are
     created.
   - Each template parameter. A `state` parameter opens the state picker.
5. Review the state preview and **Generate**.

The apply flow:

1. evaluates and validates the template,
2. builds the state specs and the machine,
3. creates/updates the states,
4. validates the merged logic document,
5. creates the device when a device name is given,
6. inserts the machine.

A state-creation or validation failure aborts before the logic is inserted.

## 4. Generated logic

### HTTP mode

One machine with one state `Run` and output **Memory**:

- a timer input `poll` (the `poll` parameter, default `30s`);
- a read row that calls `readRequest`, `fetchJson`, maps each item and writes
  with `ack: item.ack ?? true`;
- one write row per writable item, with `ack: "false"` and edge `change` (or
  `any` for `updateAlways`);
- read-only items get no write row.

The ack split is deliberate: poll feedback (`ack: true`) never triggers a
write; a user/script command (`ack: false`) does.

### State mode

One machine with one state `Run`, output **Memory**:

- one state input `source` (the selected state);
- one row on `source` that parses the value, maps each item and writes with
  `ack: true`;
- no timer, no write rows.

The machine stays in `Run`; it does not transition.

## 5. Device entry (optional)

If **Device name** is filled, the apply flow also creates a normal device in the
device registry:

- `id`: fresh unique id; `name`: the entered name.
- `type`: `template.deviceType` when it is a known device type, otherwise
  `Custom`.
- `controls`: one per `itemList` entry:
  - `stateId`: `<baseState>.<item.name>`
  - `feature`: `item.feature` when set, otherwise derived from the role/type
  - `writable: !readOnly`
  - `label`, `unit`, `role`, `type`, `states`, `min/max/step`, `hidden`
- no room or tile placement; the device appears in **Devices** and can be
  placed on a page.

The `Meter` device type has `power`, `energy`, `voltage` and `current`
features. Its preset shows power as the headline value and energy as a badge;
voltage and current are available in the detail page.

If the name is empty or only whitespace, no device is created and the apply
behaves exactly as before.

## 6. State creation is idempotent

The apply flow compares the desired `common` with the existing object and:

- **equal** → no object write at all;
- **different** → writes the full object with the changed common keys;
- **missing** → creates it and sets the initial value.

Owned keys compared: `name`, `type`, `role`, `read`, `write`, `unit`, `states`,
`min`, `max`, `step`, `def`. Extra existing keys (`custom`, `smartName`,
`desc`, …) are preserved. `states` compares object and JSON-string forms
canonically; a state with no labels gets `states: {}` to clear stale labels.

Existing **foreign** states (outside the adapter namespace) are never
overwritten. If a template would target one, the apply aborts with the skipped
ids rather than silently taking it over.

The same creator is used for logic output states and global variable states;
the goal is no object churn when nothing changed.

## 7. Validation

Template validation checks:

- source evaluates to an object;
- `itemList` is non-empty; names are unique, non-empty, match
  `[A-Za-z0-9_-]+`, do not start with `$`, and are not `poll`;
- `type` is valid; `label`/`role`/`unit` are strings; `source` is a string or an
  array of strings/numbers; `states` is an object or valid JSON string;
- writable items have a non-empty `foreignWriteName`;
- `ack: false` on a writable item is rejected;
- parameters have a unique name, a known type, no `baseState`; defaults match
  the type and a duration default parses;
- request/conversion functions are synchronous; `async` is rejected;
- state mode: a `source` state parameter exists and every item is read-only.

The generated logic is validated with the normal document validator before it
is inserted. The merged document is validated before saving.

## 8. Security and limits

- Template code is trusted user code. It runs in the SPA at apply time and in
  the logic vm at runtime; the vm is not a security boundary.
- Plain string parameters (including tokens) are embedded in the logic document
  and visible in ioBroker. Use a `state` parameter for secrets so the value is
  read at runtime.
- `fetchJson` has a 10 s timeout, a 1 MB response cap and one request in flight
  per logic. A poll interval should exceed 10 s.
- The poll can overwrite a just-sent command before the device applies it. A
  generic pending guard is not implemented; use `updateAlways`/`ack`
  deliberately.
- No live link, regeneration, dashboard tile placement or retry.
- When a device name is given, a device entry with controls is created; tile
  placement remains manual.

## 9. Troubleshooting

- **No read:** check the adapter log, that the URL is reachable from the
  adapter host (not just your browser), and that the running adapter build has
  `fetchJson`.
- **No write:** the state change must be `ack: false`. Poll feedback is
  `ack: true` and is intentionally ignored by write rows.
- **Apply error:** `baseState` must start with the adapter namespace and must
  not use the reserved folders.
- **Token parameter:** the apply form requires a selected state even if its
  value is empty; the template then sends whatever the state contains.
- **State mode does nothing:** confirm the source state changes, its value is
  valid JSON when it is a string, and the item `source` paths match the JSON
  keys (use arrays for keys containing dots).
- **Docker:** `localhost` inside the ioBroker container is not your PC; use the
  host IP for a local mock server.
