// @ts-nocheck
// import socketio from 'socket.io-client/dist/socket.io.js'
import "@iobroker/ws";
import { connectPlan, loadIo2Client } from "./socket-client";
import { resolveConnection } from "./transport";
import { subscriptionPlan } from "./subscriptions";
import { customs, enums, states, objects } from "./StateClass.svelte.js";
import { getVisibility, reloadOnReturn, typeOfP } from "./tools.svelte";
import { setContext, getContext } from "svelte";
import { createDeferredPromise } from "./utils";

// import { toasts } from "$lib/ToastsClass.svelte.js";
// import { setContext } from 'svelte';

/** The client the live socket was created with (`io2` or `ws`), so a switch
 *  of transport recreates the socket instead of calling `connect` on it. */
let connectedClient = null;

/** @type {import("@iobroker/ws").SocketClient | null} */
let socket = null;
let connectTimeoutId = null;

/**
 * The adapter instance whose data this UI edits. Also the socket handshake
 * name; writes are stamped `system.adapter.<namespace>` so they trace back to
 * the ihome adapter.
 */
export const DEFAULT_NAMESPACE = "ihome.0";

export const ioBroker = $state({
  serviceWorker: navigator.serviceWorker,
  socket,
  connected: 0,
  /** Which client is live: "io2" (the web adapter's socket.io) or "ws" (the
   *  admin's ws-server). Shown in the settings; set on every connect. */
  transport: null,
  /** The address the connect resolved, for the settings' "via <url>". */
  brokerUrl: null,
  visibilityState: getVisibility(),
  states,
  customs,
  objects,
  enums,
  // metas,
  language: "en",
  namespace: DEFAULT_NAMESPACE,
  adapterConfig: "system.adapter.admin.0",

  async waitConnected() {
    await this.wait(10);
    const oldt = Date.now();

    // while (!this.connectedPromise) {
    // 	const time = Date.now() - oldt;
    // 	console.log('Waiting for connection...', time);
    // 	if (time > 3000) break;
    // 	await this.wait(200);
    // }
    // return this.connectedPromise.then(t => console.log('connected'), e => console.error('connected.error', e));

    // const waitconn = new createDeferredPromise();
    // const oldt = Date.now();
    // if (!ioBroker.socket)
    while (!ioBroker.connected) {
      const time = Date.now() - oldt;
      console.log("Waiting for connection...", time);
      if (time > 3000) break;
      await this.wait(50);
    }
    return this;
    // return this.connectedPromise;
  },

  async wait(num = 1) {
    return new Promise((resolve) => setTimeout(resolve, num));
  },

  async getState(...args) {
    return getState(...args);
  },

  async getObject(...args) {
    return getObject(...args);
  },

  async setState(...args) {
    return setState(...args);
  },

  async emitAsync(...args) {
    return emitAsync(...args);
  },

  emitOnly(...args) {
    return emitOnly(...args);
  },

  /**
   * (Re)arm the subscriptions: what the app uses, plus the adapter's own
   * namespace. Not `subscribe("*")` — the cloud adapter forwards every
   * subscribed change into the tunnel and blocks the account when the rate is
   * too high (subscriptions.ts has the whole story). Called on connect, on
   * reconnect and whenever the registry adds ids (states.svelte.js).
   */
  syncSubscriptions() {
    const live = ioBroker.socket;
    if (!live?.emit) return;
    const plan = subscriptionPlan(getUsedStateIds(), ioBroker.namespace);
    live.emit("subscribe", plan.states);
    live.emit("subscribeObjects", plan.objects);
  },

  async sendTo(instance, command, data, timeout = 30000) {
    return emitAsyncNoErr("sendTo", instance, command, data);
  },

  get adapterConfigName() {
    return `system.adapter.${this.namespace}`;
  },

  adapterFrom(id = "") {
    const aname = id.split(".").shift();
    const along = "system.adapter." + aname;
    const adapter = this.objects.get(along);
    // console.log('adapterFrom', id, aname, along, adapter)
    return adapter;
  },

  getUuid() {
    return this.objects.get("system.meta.uuid")?.native?.uuid;
  },

  get systemConfig() {
    return objects.getObject("system.config");
  },

  get systemCertificates() {
    return objects.getObject("system.certificates");
  },

  getAdapters(instance = false) {
    const ret = {};
    const inst = instance ? "instance" : "adapter";
    this.objects.values().forEach((obj) => {
      const { _id, type } = obj;
      if (_id.startsWith("system.adapter.") && type == inst) ret[_id] = obj;
    });
    return ret;
  },

  /// @name t_name
  ///  returns name of object if there is a name selection according local language  possible
  ///
  /// @returns {string} -
  /**
   * @param {{ [x: string]: any; }} name
   */
  t_name(name) {
    if (!name) return name;
    if (typeof name === "string") return name;
    else
      return (
        name[this.language] || name["en"] || name[Object.keys(name).shift()]
      );
    // return typeOf(name);
  },

  /// @name getObjectView
  ///
  ///
  /// @param {string} type ['state' | instance | channel | script] -
  /// @param {any} select [null] | {startkey: 'system.adapter.', 'system.adapter.\u9999', depth: 0}
  /// @returns {any} -
  // async getObjectView(type = 'state', select = null) {
  // 	if (typeof type !== 'string') throw new Error(`ObjectView Type as String is required! ${type}`);
  // 	if (select && typeof select === 'string') {
  // 		select = {
  // 			startkey: select.replace(/\*/g, ''),
  // 			endkey: select.replace(/\*/g, '\u9999')
  // 		};
  // 	}
  // 	let res = await emitAsync('getObjectView', 'system', type, select);
  // 	// const map = new SvelteMap();
  // 	const map = {};
  // 	res = res?.rows || [];
  // 	// console.log('ObjectView', type, select, res);
  // 	res.forEach((item) => (map[item.id] = item.value));
  // 	return map;
  // },

  // async getObjects(id, type) {
  // 	if (!id || !typeOfP(id).isString) throw new Error(`getObjects ID is required! ${id} of class ${typeOfP(id).class}`);
  // 	try {
  // 		const res = type ? await emitAsync('getObjects', id , type) : await emitAsync('getObjects', id);
  // 		console.log('getObjects', id, res);
  // 		return res;
  // 	} catch (e) {
  // 		console.error(`getObjects error with '${id}'`, e);
  // 		return {};
  // 	}
  // },
  // getEnums(type) {
  // 	// this.enums.clear();
  // 	if (!this.enums.size) this.enums.init(ioBroker.objects);
  // 	return this.enums.getList(type);
  // },

  async getAllObjects() {
    try {
      const res = await emitAsync("getAllObjects");
      console.log("getAllObjects", res);
      return res;
    } catch (e) {
      console.error(`getAllObjects error:`, e);
      return {};
    }
  },

  // async getEnums(type) {
  // 	let res = await emitAsync('getEnums');
  // 	res = res?.rows || [];
  // 	console.log('ObjectView', type, res);
  // 	// res.forEach(item => map.set(item.id, item.value));
  // 	return res;
  // },

  async connectIOBroker(...args) {
    return connectIOBroker(...args);
  },

  async getHistory(id, options) {
    let res = await emitAsync("getHistory", id, options);
    // console.log('GetHistory:', id, options, res)
    // res = res?.rows || [];
    return res;
  },
});

// setContext('ioBroker', ioBroker);
// ioBroker.visibilityState = visibilityState;

document.onreadystatechange = () => {
  Object.assign(ioBroker.visibilityState, getVisibility());
  //   ioBroker.visibilityState = visibilityState = getVisibility();
  // console.log('onReadyStateChange', ioBroker.visibilityState);
};

/** Last time the page was actually on screen (see `reloadOnReturn`). */
let lastVisible = Date.now();

document.onvisibilitychange = () => {
  Object.assign(ioBroker.visibilityState, getVisibility());
  if (document.visibilityState !== "visible") return;
  // A tab that slept comes back with a dead socket that never reconnects, so
  // reload instead of waiting. Editor forms only live in memory until Save, so
  // an open config page is left alone.
  if (reloadOnReturn(lastVisible) && !location.pathname.startsWith("/config")) {
    location.reload();
    return;
  }
  lastVisible = Date.now();
  // console.log('onVisibilityChange', ioBroker.visibilityState);
};

async function connectIOBroker(options = {}) {
  // @ts-ignore
  ioBroker.connectOptions = Object.assign(
    {},
    {
      namespace: DEFAULT_NAMESPACE,
      url: "",
      // adapterConfig,
      rectreateSocket: false,
    },
    options,
  );
  let {
    namespace,
    url,
    rectreateSocket,
    explicit,
    hostPort,
    fetchInfo,
    ...roptions
  } = ioBroker.connectOptions;
  ioBroker.namespace = namespace;
  // Which client, at which address. An explicit url keeps the ws client; the
  // sources go through the rule table (transport.ts), whose third rule needs
  // the web adapter's info file — hence the await here and not in the caller.
  const connection = url
    ? { transport: "ws", url }
    : await resolveConnection({
        explicit: explicit || undefined,
        hostPort: hostPort || undefined,
        origin: location.origin,
        host: location.host,
        protocol: location.protocol,
        fetchInfo: fetchInfo ?? (async () => null),
      });
  ioBroker.transport = connection.transport;
  // The address the UI shows ("via <url>"). Deliberately *not* in
  // connectOptions.url: a non-empty url there means "an explicit address ⇒ the
  // ws client" (the check above), and this one is a resolved io2 origin.
  ioBroker.brokerUrl = connection.url;
  const plan = connectPlan(connection);
  ioBroker.connectedPromise = createDeferredPromise();
  // clear the timeout of a previous connect attempt, otherwise it rejects
  // the promise of this attempt while it is still pending
  if (connectTimeoutId) clearTimeout(connectTimeoutId);
  connectTimeoutId = setTimeout(() => {
    ioBroker.connectedPromise.reject("Timeout for Iobroker connection!");
  }, 10000);
  const timeout = connectTimeoutId;
  console.log("connectIOBroker", ioBroker.connectOptions);
  // ioBroker.adapterConfigName = adapterConfig ?? `system.adapter.${namespace}`;
  try {
    const transportChanged = plan.client !== connectedClient;
    if (!socket || rectreateSocket || transportChanged) {
      const prev = socket || ioBroker.socket;
      if (prev) {
        // destroy() also cancels the auto-reconnect timer of the old client,
        // otherwise it keeps retrying the old url in the background
        typeof prev.destroy === "function" ? prev.destroy() : prev.disconnect();
      }
      states.clear();
      // The io2 client comes from the server that served this page; without
      // it (a dev server, a bare PWA) there is nothing to connect with.
      const client =
        plan.client === "io2" ? await loadIo2Client() : globalThis.io;
      if (!client) {
        console.warn(
          "[Socket] the web adapter's socket.io client is not available — staying disconnected",
        );
        ioBroker.connected = 0;
        return;
      }
      // The client starts connecting right here, so the handlers registered in
      // this same tick still precede any server event. A synchronous
      // construction error is swallowed inside the client, which is why the
      // 10 s waitconn timeout plus ioBroker.connected = 0 stays the signal.
      ioBroker.socket = socket = client.connect(plan.url, plan.options);
      connectedClient = plan.client;
      ioBroker.connected = 0;
    } else {
      // The reuse path is the ws client's (`connect(url, options)`); the io2
      // socket cannot switch address and is always recreated above.
      socket.connect(plan.url, plan.options);
    }
    const waitconn = new createDeferredPromise();

    // await new Promise((resolve, reject) => {
    // Keep the object cache current for every object — discovery and the
    // object info of used states both read from it.
    socket.on("objectChange", (objectId, obj) => {
      if (obj) objects.update(objectId, obj);
    });
    // Only *used* states live in the state cache and only they are updated.
    socket.on("stateChange", (stateId, state) => {
      if (!getUsedStateIds().has(stateId)) return;
      state.now = Date.now();
      states.update(stateId, state);
    });
    socket.on("reauthenticate", (r) =>
      console.warn("[Socket] reauthenticate", r),
    );
    socket.on("message", (r) => console.log("[Socket] message: ", r));
    // socket.on('error', (e) => console.error('[Socket] error: ', e));
    socket.on("permissionError", (e) =>
      console.error("[Socket] permission error: ", e),
    );
    socket.on("error", (error) => {
      console.error("Socket.IO error:", error);
      waitconn.reject(error);
      // if (!ioBroker.connected) reject();
      socket.disconnect();
      socket = null;
      ioBroker.connected = 0;
    });
    socket.on("reconnect", function () {
      console.debug("[Socket] reconnect");
      ++ioBroker.connected;
      socket.emit("name", namespace);
      // The subscription died with the old connection: without re-arming it,
      // the dashboard would freeze on the values it last saw — and a tile
      // toggle, which is relative to the live value, would look like it did
      // nothing. The same used set as on connect, so a reconnect stays cheap.
      ioBroker.syncSubscriptions();
      //Connected -> Starting point
      // if(!reconnectedShortly){
      // 	console.log('Socket connected - getStarted');
      // 	getStarted("triggeredByReconnection");
      // } else {
      // console.log('Socket connected - But it connected shortly before, so this event will be ignored');
      // clearTimeout(reconnectedShortly);
      // $('.loader').hide();
      // }
      // reconnectedShortly = setTimeout(function(){reconnectedShortly = false;}, 5000);
    });
    socket.on("disconnect", (r) => {
      console.warn("[Socket] disconnected", r);
      ioBroker.connected = 0;
    });
    socket.on("connect_error", function (e) {
      console.error("[Socket] connect error: " + e);
      if (!ioBroker.connected) waitconn.reject(e);
    });
    socket.on("connect", (r) => {
      console.warn("[Socket] connected", r);
      ioBroker.connected = 1;
      waitconn.resolve(socket);
      // resolve(socket);
    });

    //   console.log("Connected to Socket.IO server");
    setTimeout(() => waitconn.reject(), 10000);

    await waitconn;
    await ioBroker.wait(10);
    await ioBroker.waitConnected();
    emitOnly("name", namespace);
    await ioBroker.wait(10);
    ioBroker.objects.clear();
    await ioBroker.wait(10);
    ioBroker.objects.init(await ioBroker.getAllObjects());
    await ioBroker.wait(10);
    ioBroker.enums.clear();
    ioBroker.enums.init(ioBroker.objects);
    await ioBroker.wait(10);
    ioBroker.customs.init(ioBroker.objects);
    await ioBroker.wait(10);
    ioBroker.adapterConfig = objects.getObject(ioBroker.adapterConfigName);
    ioBroker.language = ioBroker.systemConfig?.common?.language || "en";
    // Same rule as on reconnect: only what the app uses, plus ihome.0.*.
    ioBroker.syncSubscriptions();
    await ioBroker.wait(10);
    clearTimeout(timeout);
    ioBroker.connectedPromise.resolve(ioBroker.systemConfig);
    ioBroker.connectedPromise = Promise.resolve(ioBroker.systemConfig);
    return ioBroker.systemConfig;
  } catch (error) {
    console.error("Failed to connect to Socket.IO server:", error);
    ioBroker.connected = 0;
    ioBroker.connectedPromise.reject(error);
    return null;
  }
}

export function emitAsync(event, ...data) {
  // console.log('emitAsync', event, data);
  const now = -Date.now();

  if (!ioBroker.connected || !socket) {
    console.warn(
      `emitAsync ioBroker not connected in ${event} with ${JSON.stringify(data)}`,
    );
    return void 0;
  }

  const pr = createDeferredPromise();
  let to = setTimeout(
    () =>
      pr.reject(
        new Error(`emitAsyncTimeout in ${event} with ${JSON.stringify(data)}`),
      ),
    15000,
  );
  socket.emit(event, ...data, (error, response) => {
    if (error && error !== null) {
      to && clearTimeout(to);
      to = null;
      console.warn(`emitAsyncError in ${event}:`, error, response);
      pr.reject(response?.error || error);
    } else {
      to && clearTimeout(to);
      to = null;
      // console.log(`emitAsyncResponse in ${event}:`, ageString(now), response);
      setTimeout(() => pr.resolve(response), 1);
      // pr.resolve(response);
    }
  });
  return pr;
}

export function emitAsyncNoErr(event, ...data) {
  // console.log('emitAsync', event, data);
  const now = -Date.now();
  const timeout =
    typeof data.slice(-1)[0] === "number" && typeof data.slice(-1)[0] > 5000
      ? data.pop()
      : 30000;

  if (!ioBroker.connected) {
    console.warn(
      `emitAsyncNoErr ioBroker not connected in ${event} with ${JSON.stringify(data)}`,
    );
    return void 0;
  }
  const pr = createDeferredPromise();
  let to = setTimeout(
    () =>
      pr.reject(
        new Error(`emitAsyncTimeout in ${event} with ${JSON.stringify(data)}`),
      ),
    timeout,
  );

  socket.emit(event, ...data, (result, response) => {
    to && clearTimeout(to);
    to = null;

    setTimeout(() => pr.resolve(result), 1);
    // pr.resolve(result);
  });
  return pr;
}

export function emitOnly(event, ...data) {
  if (!ioBroker.connected || !socket) return void 0;
  return socket.emit(event, ...data);
}

export async function getState(id, update = false) {
  if (!id || !typeOfP(id).isString) {
    console.error(
      `getState ID is required! ${id} of class ${typeOfP(id).class}`,
    );
    return null;
  }
  // console.log("getState:", id, options);
  let st = states.get(id);
  try {
    if (!st || update) {
      const stn = await emitAsync("getState", id);
      // console.log("getState", id, JSON.stringify(stn), options);
      if (stn) {
        // && 'val' in stn && 'ts' in stn && 'from' in stn) {
        if (st) {
          // st.config={};
          st = states.update(id, stn);
        } else {
          const options = {};
          if (typeOfP(update).isObject) Object.assign(options, update);
          else if (typeOfP(update).isBoolean) options.updateAlways = update;
          st = states.add(id, stn, options);
        }

        // st.config = {};
      } else {
        console.warn(`getState: State ${id} not found`);
        return null;
      }
    }
    if (!st._id) {
      await getObject(id);
    }
    // console.log("getState obj", id, JSON.stringify(st.config));
  } catch (e) {
    console.error(`getState error with '${id}':`, e);
    return null;
  }
  // console.log("getState", id, st.toString(), Object.keys(st.config));
  return st;
}

export async function getObject(id, update = false) {
  if (!id || !typeOfP(id).isString) {
    console.error(
      `getObject ID is required! ${id} of class ${typeOfP(id).class}`,
    );
    return null;
  }
  const obarr = [objects, enums, customs];
  let src = null;
  for (let i of obarr) {
    if (i.has(id)) {
      src = i;
      break;
    }
  }
  let st;
  try {
    st = src && !update ? src.get(id) : await emitAsync("getObject", id);
    if (st && st._id === id && update) {
      if (src) st = src.update(id, st);
      else if (st.type === "enum") enums.update(id, st);
      else if (st.type === "meta") objects.update(id, st);
      else objects.update(id, st);
    }
  } catch (e) {
    console.error(`getObject error with '${id}':`, e);
    return null;
  }
  // console.log("getState obj", id, JSON.stringify(st.config));
  return st;
}

// console.log('Finished ioBroker: ',ioBroker);
export async function setState(id, val) {
  if (typeof id !== "string") throw new Error(`State ID is required! ${id}`);
  if (typeof val !== "object" || ("val" in val && "from" in val)) {
    val = {
      val,
      ts: Date.now(),
      from: `system.adapter.${ioBroker.namespace}`,
    };
  }
  return emitAsync("setState", id, val);
}

export function startUp(options) {
  // console.log('startUp with options:', options);
  if (!options) options = ioBroker.connectOptions;
  typeof options === "object" && connectIOBroker(options);
  ioBroker.waitConnected();

  return ioBroker;
}

const IOBROKER = Symbol("IOBROKER");

export function ioBrokerStart(options) {
  return setContext(IOBROKER, startUp(options));
}

export function getIoBroker() {
  return getContext(IOBROKER);
}

import { getUsedStateIds } from "./stores/devices.svelte.js";
