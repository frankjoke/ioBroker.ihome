/** The shared maps behind the engine: who references which state, memory name
 *  or logic output, and what the last value was. A map is the authority for
 *  dispatch; per-logic read caches stay in the engine. */

export interface Owner {
  id: string;
  seq: number;
}

export interface Binding<O extends Owner = Owner> {
  owner: O;
  /** The input row name inside the owner. */
  input: string;
  lastStateId?: string;
  lastSeen?: number;
  lastValue?: unknown;
  hasLast?: boolean;
  lastFrom?: string;
  lastAck?: boolean;
  lastTs?: number;
}

/** What the engine knows about one broker change. */
export interface StateChangeLike {
  val: unknown;
  ack?: boolean;
  from?: string;
  ts?: number;
  changed?: boolean;
}

export interface StateEntry<O extends Owner = Owner> {
  value: unknown;
  previous: unknown;
  hasPrevious: boolean;
  ack?: boolean;
  from?: string;
  ts?: number;
  changed: boolean;
  links: Binding<O>[];
  selves: O[];
}

export interface StateHit<O extends Owner = Owner> {
  entry: StateEntry<O>;
  /** The entry's value and "had a value" before this change. */
  previous: unknown;
  hasPrevious: boolean;
  links: Binding<O>[];
  selves: O[];
}

export function createStateMap<O extends Owner>() {
  const entries = new Map<string, StateEntry<O>>();

  const entryFor = (
    id: string,
    seed: StateChangeLike | undefined,
    fallback: unknown,
  ): StateEntry<O> => {
    const entry: StateEntry<O> = {
      value: seed ? seed.val : fallback,
      previous: undefined,
      hasPrevious: seed !== undefined || fallback !== undefined,
      ack: seed?.ack,
      from: seed?.from,
      ts: seed?.ts,
      changed: seed?.changed ?? false,
      links: [],
      selves: [],
    };
    entries.set(id, entry);
    return entry;
  };

  return {
    link(
      id: string,
      binding: Binding<O>,
      seed: StateChangeLike | undefined,
      fallback: unknown,
    ): void {
      const entry = entries.get(id) ?? entryFor(id, seed, fallback);
      entry.links.push(binding);
    },
    self(
      id: string,
      owner: O,
      seed: StateChangeLike | undefined,
      fallback: unknown,
    ): void {
      const entry = entries.get(id) ?? entryFor(id, seed, fallback);
      if (!entry.selves.includes(owner)) entry.selves.push(owner);
    },
    unlink(owner: O): void {
      for (const [id, entry] of entries) {
        entry.links = entry.links.filter((link) => link.owner !== owner);
        entry.selves = entry.selves.filter((self) => self !== owner);
        if (entry.links.length === 0 && entry.selves.length === 0) {
          entries.delete(id);
        }
      }
    },
    change(id: string, change: StateChangeLike): StateHit<O> | undefined {
      const entry = entries.get(id);
      if (!entry) return undefined;
      const previous = entry.value;
      const hasPrevious = entry.hasPrevious;
      entry.value = change.val;
      entry.hasPrevious = true;
      entry.changed = change.changed ?? !Object.is(previous, change.val);
      if (change.ack !== undefined) entry.ack = change.ack;
      if (change.from !== undefined) entry.from = change.from;
      if (change.ts !== undefined) entry.ts = change.ts;
      return {
        entry,
        previous,
        hasPrevious,
        links: [...entry.links],
        selves: [...entry.selves],
      };
    },
    get(id: string): StateEntry<O> | undefined {
      return entries.get(id);
    },
  };
}

export interface MemoryEntry<O extends Owner = Owner> {
  value: unknown;
  previous: unknown;
  hasPrevious: boolean;
  ts?: number;
  from?: string;
  changed: boolean;
  links: Binding<O>[];
}

export interface MemoryMap<O extends Owner> {
  seed(name: string, value: unknown, meta?: { ts: number; from: string }): void;
  write(
    name: string,
    value: unknown,
    meta: { ts: number; from: string },
  ): { previous: unknown; hasPrevious: boolean };
  link(name: string, binding: Binding<O>): void;
  unlink(owner: O): void;
  get(name: string): MemoryEntry<O> | undefined;
  remove(name: string): void;
  links(name: string): Binding<O>[];
}

export function createMemoryMap<O extends Owner>(): MemoryMap<O> {
  const entries = new Map<string, MemoryEntry<O>>();

  const entryFor = (name: string): MemoryEntry<O> => {
    const entry: MemoryEntry<O> = {
      value: undefined,
      previous: undefined,
      hasPrevious: false,
      changed: false,
      links: [],
    };
    entries.set(name, entry);
    return entry;
  };

  return {
    seed(name, value, meta) {
      const entry = entries.get(name) ?? entryFor(name);
      entry.value = value;
      entry.hasPrevious = true;
      entry.changed = false;
      entry.ts = meta?.ts;
      entry.from = meta?.from;
    },
    write(name, value, meta) {
      const entry = entries.get(name) ?? entryFor(name);
      const previous = entry.value;
      const hasPrevious = entry.hasPrevious;
      entry.previous = previous;
      entry.hasPrevious = true;
      entry.value = value;
      entry.changed = !hasPrevious || !Object.is(previous, value);
      entry.ts = meta.ts;
      entry.from = meta.from;
      return { previous, hasPrevious };
    },
    link(name, binding) {
      const entry = entries.get(name) ?? entryFor(name);
      entry.links.push(binding);
    },
    unlink(owner) {
      for (const entry of entries.values()) {
        entry.links = entry.links.filter((link) => link.owner !== owner);
      }
    },
    get(name) {
      return entries.get(name);
    },
    remove(name) {
      entries.delete(name);
    },
    links(name) {
      return entries.get(name)?.links ?? [];
    },
  };
}

export interface LogicIndex<O extends Owner> {
  link(id: string, binding: Binding<O>): Binding<O>;
  linkRow(id: string, owner: O): void;
  unlink(owner: O): void;
  get(id: string): { inputs: Binding<O>[]; rows: O[] } | undefined;
}

/** `$logic.<id>` readers, split into input rows and machine rows. */
export function createLogicIndex<O extends Owner>(): LogicIndex<O> {
  const entries = new Map<string, { inputs: Binding<O>[]; rows: O[] }>();

  const entryFor = (id: string) => {
    const entry = { inputs: [] as Binding<O>[], rows: [] as O[] };
    entries.set(id, entry);
    return entry;
  };

  return {
    link(id, binding) {
      entryFor(id).inputs.push(binding);
      return binding;
    },
    linkRow(id, owner) {
      const entry = entryFor(id);
      if (!entry.rows.includes(owner)) entry.rows.push(owner);
    },
    unlink(owner) {
      for (const [id, entry] of entries) {
        entry.inputs = entry.inputs.filter((link) => link.owner !== owner);
        entry.rows = entry.rows.filter((row) => row !== owner);
        if (entry.inputs.length === 0 && entry.rows.length === 0) {
          entries.delete(id);
        }
      }
    },
    get(id) {
      const entry = entries.get(id);
      return entry
        ? { inputs: [...entry.inputs], rows: [...entry.rows] }
        : undefined;
    },
  };
}
