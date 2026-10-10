// @ts-nocheck
// import { on } from 'events';
import { SvelteDate, SvelteMap } from "svelte/reactivity";
import {
  ageString,
  typeOf,
  niceJson,
  typeOfP,
  getSelector,
} from "./tools.svelte";
import { ioBroker } from "./ioBrokerConnect.svelte";

// ObjectType: "state" | "channel" | "device" | "folder" | "enum" | "adapter" | "config" | "group" | "host" | "instance" | "meta" | "script" | "user" | "chart" | "schedule" | "design"

export class ObjectMap extends SvelteMap {
  _onUpdate = undefined;
  #name = "ObjectMap";
  constructor(name = "ObjectMap") {
    super();
    this.#name = name;
    return this;
  }

  // get _proxy() {
  // 	return new Proxy(this, {
  // 		get(target, propKey, receiver) {
  // 			console.log(`get in ${this.constructor.name}`, propKey, target, receiver)
  // 			if (propKey === void 0) return undefined;
  // 			if (propKey in target) return this[propKey];
  // 			if (target.has(propKey)) return this.get[propKey];
  // 			// if (propKey in target.config) return target.config[propKey];
  // 			// Default handling
  // 			return Reflect.get(target, propKey, receiver);
  // 		}
  // 	});
  // }

  toString(x) {
    return `${this.#name}(${this.size})`;
  }

  get onUpdate() {
    return this._onUpdate;
  }

  set onUpdate(value) {
    this._onUpdate = value;
  }

  init(objectView = []) {
    // this.clear();
    this.addData(objectView);
  }

  appendTo(obj = {}) {
    this.entries().forEach(([key, value]) => (obj[key] = value));
    return obj;
  }

  addData(objectView = []) {
    // console.log(`init ${this.toString()}:`, typeOf(objectView), objectView);
    if (Array.isArray(objectView))
      objectView.forEach(({ id, value }) => {
        this.set(id, value);
      });
    else
      Object.entries(objectView).forEach(([id, value]) => {
        this.set(id, value);
      });
    // console.log(this.toString());
  }

  getObject(id, update = false) {
    if (!id || !typeOfP(id).isString)
      throw new Error(`getObject ID is required! ${id} of class ${typeof id}`);
    let st = this.get(id);
    if (!st || update) {
      const stn = ioBroker.getObject(id, update);
      if (stn && stn._id === id) {
        this.set(id, stn);
        st = stn;
      }
    }
    return st;
  }

  update(id, config) {
    if (!id)
      throw new Error(`State ID is required! ${id}: ${niceJson(config)}`);
    if (typeof config !== "object")
      throw new Error(`Config object required! ${id}: ${niceJson(config)}`);

    const doUpdate =
      typeOf(this.onUpdate) !== "function" || this.onUpdate(id, config);

    doUpdate && this.set(id, config);
    // let stateObj = this.get(id); // || this.add(id, state ?? {ts:Date.now(), val:null}, config);
    // stateObj && stateObj.updateConfig(config);

    // const { ts, user, from } = config;
    // state ??= Object.assign({}, { ts, user, from, val: null }, state);
    // stateObj ??= this.add(id, state, config);

    // console.log(`State config updated: ${id}`, stateObj.toString(), config);
    return config;
  }

  getIdList(val = "") {
    const reg = typeOfP(val).isRegExp;

    const res = [];
    this.entries().forEach(([id, enu]) => {
      if (
        (reg && val.test(id)) ||
        (typeof val === "string" && (!val || id?.startsWith(val)))
      )
        res.push(enu);
    });
    console.log("getIdList found in", this.toString(), res.length, res);
    return res;
  }

  allEntries(obj = false) {
    if (obj) {
      const res = {};
      this.entries().forEach(([id, val]) => {
        res[id] = val;
      });
      return res;
    }
    return Array.from(this.entries());
  }

  getSelector(id, name) {
    return getSelector(this.get(id), name);
  }
}
// set(id, value) {
// 	console.log('set', id, value);
// 	super.set(id, value);
// }

export const objects = new ObjectMap();
// export const channels = new ObjectMap('ChannelMap');
// export const devices = new ObjectMap('DeviceMap');
// export const stateMap = new ObjectMap('StateMap');
// export const metas = new ObjectMap('MetaMap');
// export const folders = new ObjectMap('FolderMap');
// export const instances = new ObjectMap('InstanceMap');

// export, devices, stateView
export class StateClass {
  static _proxyCLass = {
    get(target, propKey, receiver) {
      if (propKey in target) return target[propKey];
      if (propKey in target.state) return target.state[propKey];
      if (propKey in target.config) return target.config[propKey];
      // Default handling
      return Reflect.get(target, propKey, receiver);
    },
    set(target, propKey, value, receiver) {
      console.log("set", propKey, value, receiver, propKey in target);
      return propKey in target && Reflect.set(target, propKey, value, receiver);
    },
  };
  // config = $state.raw({ common: {}, _id: '' });
  state = $state({ ts: Date.now(), val: null });
  oldState = {};
  updated;
  _history = $state.raw([]);
  // sts = new SvelteDate(Date.now());
  #id = "";
  #onUpdate = undefined;
  #updateAlways = false;

  get config() {
    return objects.get(this.#id) ?? {};
  }

  get object() {
    return this.config;
  }

  get _proxy() {
    return new Proxy(this, StateClass._proxyCLass);
  }

  constructor(id, state = {}, options = {}) {
    if (!id || typeof id !== "string")
      throw new Error(`State ID is required! ${id}: ${JSON.stringify(state)}`);
    this.#id = id;
    // this._history = $state([]);
    state.ts ??= Date.now();
    state.val ??= null;
    state.from ??= "";
    // this.setOptions(Object.assign({}, { updateAlways: false }, options));
    // Object.assign(this.config, config);
    const { updateAlways, onUpdate } = options;
    this.#updateAlways = updateAlways;
    if (onUpdate) this.onUpdate = onUpdate;
    Object.assign(this.state, state);
    this.update(state);
    return this;
  }

  get updateAlways() {
    return this.#updateAlways;
  }

  set updateAlways(value) {
    this.#updateAlways = value;
  }

  get history() {
    return this._history;
  }

  set history(value) {
    this._history = value;
    // const options = this.options;
    // options.history = value;
  }

  // get onUpdate() {
  // 	return this.#onUpdate;
  // }

  set onUpdate(value) {
    if (typeof value !== "function")
      throw new Error(`onUpdate must be a function! ${JSON.stringify(value)}`);
    this.#onUpdate = value;
  }

  getHistory() {
    return this._history;
  }

  setHistory(value) {
    this.history = value;
  }

  // clearOptions() {
  // 	this.options = { updateAlways: false };
  // }

  clearHistory() {
    this.history = [];
    // this.setOptions(options);
  }

  get enums() {
    return enums.getEnums(this.id);
  }
  // setOptions(options = {}) {
  // 	Object.assign(this.options, options);
  // }

  update(state) {
    // const { onUpdateState } = this.options;
    if (this.#onUpdate && !this.#onUpdate(this, state)) return this;
    this.updated = this.updated ? Date.now() : state.ts;
    Object.assign(this.oldState, this.state);
    Object.assign(this.state, state);

    return this;
  }

  toString() {
    const vt = `${this.config.common?.type || typeof this.value}${this.config.common?.unit ? `/${this.config.common?.unit}` : ""}`;
    const st = this.state["from"]
      ? `, [${vt}]= ${this.value}, -${this.ageString}`
      : this.config._id
        ? ` config[${Object.keys(this.config).join(", ")}]`
        : ` (empty)`;
    return `State(${this.id}${st})`;
  }

  get asObject() {
    return {
      id: this.id,
      val: this.value,
      ts: this.state.ts,
      from: this.state.from,
      name: this.name,
      ageString: this.ageString,
      type: this.type,
      role: this.role,
      unit: this.unit,
      valString: this.valString,
      config: this.config,
      state: this.state,
      history: this.history,
      enums: this.enums,
    };
  }
  getSelector(name) {
    return getSelector(this, name);
  }

  get value() {
    return this.state?.val;
  }

  get val() {
    return this.value;
  }

  get ts() {
    return this.state.ts;
  }

  get from() {
    return this.state.from;
  }

  get id() {
    return this.#id;
  }

  get age() {
    return Date.now() - (this.updated || this.state.ts);
  }

  get date() {
    return new SvelteDate(this.state.ts);
  }

  get name() {
    let name = this.config?.common?.name || this.id;
    if (typeof name === "object")
      name = name.de || name.en || name[Object.keys(name)[0]];
    if (!name.includes(".")) {
      const id = this.config._id || this.id;

      const pre = id.split(".").slice(2, -1).join(".");
      name = (pre ? pre + "." : "") + name;
    }
    return name;
  }

  get unit() {
    return this.config?.common?.unit || "";
  }

  get type() {
    return this.config?.common?.type || this.config?.type || "";
  }

  get role() {
    return this.config?.common?.role || "";
  }

  get valString() {
    if (this.value === null || this.value === undefined) return this.value;
    if (typeof this.value === "object") return JSON.stringify(this.value);
    if (typeof this.value === "boolean") return this.value ? "true" : "false";
    const val =
      typeof this.value === "number" && !Number.isInteger(this.value)
        ? this.value.toFixed(2)
        : this.value;
    return (
      String(val) +
      (this.config.common?.unit ? ` ${this.config.common?.unit}` : "")
    );
  }

  get ageString() {
    return ageString(this.age);
  }
}

export class StateMap extends ObjectMap {
  constructor() {
    super("StateMap");
    return this;
  }

  getState(id, update = false) {
    if (!id || !typeOfP(id).isString)
      throw new Error(
        `getState ID is required! ${id} of class ${typeOf(id).class}`,
      );
    let st = this.get(id);
    if (!st || update) {
      ioBroker.getState(id, update);
    }
    return st;
  }

  add(id, state = {}, options = {}) {
    if (!id)
      throw new Error(`State ID is required! ${id}: ${JSON.stringify(state)}`);
    if (typeof state !== "object")
      throw new Error(`State object required! ${id}: ${JSON.stringify(state)}`);
    options = Object.assign(
      {},
      { updateAlways: false, onUpdate: null },
      options,
    );
    // if (config ) throw new Error(`Config object not expected! ${id}: ${JSON.stringify(config)}`);
    const stateObj = this.get(id) || new StateClass(id, state, options);
    this.set(id, stateObj);
    // console.log(stateObj.toString());
    return stateObj;
  }

  update(id, state, update = false) {
    // const { update = false, ...rest } = options || { update: options };

    if (!id)
      throw new Error(`State ID is required! ${id}: ${JSON.stringify(state)}`);
    if (typeof state !== "object")
      throw new Error(`State object required! ${id}: ${JSON.stringify(state)}`);
    let stateObj = this.get(id);
    if (stateObj) {
      if (stateObj.val !== state.val || update || stateObj.updateAlways)
        stateObj.update(state, update);
    } else stateObj = this.add(id, state);
    return stateObj;
  }
}

export const states = new StateMap();

export class EnumMap extends ObjectMap {
  #lists = $state({});

  constructor() {
    super("EnumMap");
    return this;
  }

  clear() {
    super.clear();
    this.#lists = {};
  }

  get list() {
    return this.#lists;
  }

  getList(name) {
    if (name in this.#lists) {
      const cl = $state.snapshot(this.#lists);
      // const rl = cl[name];
      // console.log('getList', name, cl, rl)
      return cl[name];
    }
    return Object.values($state.snapshot(this.#lists));
  }

  isMember(id, name) {
    if (!id || !name) return false;
    if (!Array.isArray(name)) name = [name];
    const path = id.split(".");
    while (path.length > 2) {
      const entry = this.get(path.join("."));
      if (entry) {
        for (const typ of name) {
          console.log("isMember", path.join("."), typ, entry, entry[typ]);
          if (entry[typ]) return true;
        }
      }
      // if (members && members.includes(path.join('.'))) return true;
      path.pop();
    }
    // return Array.isArray(name) ? name.find(checkName) : checkName(name);
    return false;
  }

  getEnumsType(type) {
    // this.enums.clear();
    // if (!this.size) this.init(ioBroker.objects);
    return this.getList(type);
  }
  init(objectMap) {
    // this.clear();
    // super.init(objectMap);
    // console.log(`init enumMap(${this.size})`);
    objectMap.entries().forEach(([key, value]) => {
      const { _id, type, common, native } = value || {};

      if (!_id || !_id.startsWith("enum.")) return;

      // this.set(key, value);

      const { name, members = [] } = common || {};

      let [_, typ, lItem, rItem] = _id.split(".");

      lItem = lItem || rItem;
      // if (Array.isArray(members) && type==='enum') {
      // console.log('CustomMap.init', value, type, name, common, members);
      // let typ = _id && ['.favorites.', '.functions.', '.rooms.'].find((f) => _id.includes(f));
      if (typ && lItem) {
        // typ = typ.slice(1, -1);
        if (name && lItem) {
          const l = (this.#lists[typ] ??= []);
          l.push(value);
        }
        // console.log('CustomMap.init', typ, name, members);
        members.forEach((member) => {
          const e = this.get(member) ?? {};
          const et = (e[typ] ??= []);
          et.push(
            Object.assign({ _id }, common, {
              members: undefined,
              custom: undefined,
            }),
          );
          e[typ] = et;
          e[key] = value;
          this.set(member, e);
        });
      }
      // }
    });
    console.log(`initend enums(${this.size})`);
  }

  getEnums(id, ores = {}) {
    if (!id) return {};
    let res = this.get(id);
    if (res) {
      res = Object.assign({}, res, ores);
      if (res.rooms) return res;
    } else res = ores;
    const slice = id.split(".");
    if (slice.length <= 2) return null;
    slice.pop();
    return this.getEnums(slice.join("."), res);
  }
}

export const enums = new EnumMap();

export class CustomMap extends ObjectMap {
  constructor(objectView = []) {
    super("CustomMap");
    // this.init(objectView);
    return this;
  }

  init(objectMap) {
    // this.clear();
    objectMap.entries().forEach(([key, value]) => {
      const custom = value?.common?.custom;
      // custom && console.log('CustomMap.init', key, custom);
      custom && this.set(key, custom);
      // this.set(_id, common.custom);
    });
    console.log(`initend customMap(${this.size})`);
  }

  getList(instance) {
    const res = {};
    this.entries().forEach(([key, value]) => {
      value &&
        Object.entries(value).forEach(([instancekey, instancevalue]) => {
          if (!instance || instance === instancekey) {
            if (res[instancekey]) res[instancekey].push(key);
            else res[instancekey] = [key];
          }
        });
    });
    return instance ? res[instance] : res;
  }

  getItem(id, instance) {
    const res = this.get(id);
    return res && res[instance];
  }

  getAll(instance) {
    const res = {};
    this.entries().forEach(([key, value]) => {
      if (instance in value) res[key] = value[instance];
    });
    return res;
  }

  update(id, config) {}
}

export const customs = new CustomMap();
