import { createSubscriber } from "svelte/reactivity";

/**
 * @param {string []} values
 */
export function createReactiveStorage(values = [], config = {}) {
  const globalConfig = {
    prefix: "__APPNAME__",
    storage: "local",
    ...config,
  };

  // resolve config for each item
  const items = values.reduce((acc, value) => {
    let key;
    let config;
    if (Array.isArray(value)) {
      config = { init: null, ...globalConfig, ...value[1] };
      key = value[0].toString();
    } else {
      config = { ...globalConfig, init: null };
      key = value.toString();
    }

    let storage = null;
    if (config.storage === "local" && "localStorage" in globalThis) {
      storage = localStorage;
    } else if (config.storage === "session" && "sessionStorage" in globalThis) {
      storage = sessionStorage;
    }

    const keyWithPrefix = config.prefix + key;
    // @ts-ignore
    acc[keyWithPrefix] = {
      ...config,
      key,
      storage,
      value: config.init,
      update: undefined, // will be set later
    };
    return acc;
  }, {});

  const reactive = {};
  for (const [keyWithPrefix, item] of Object.entries(items)) {
    const { storage, init, key } = item;
    const subscribe = createSubscriber((update) => {
      // @ts-ignore
      items[keyWithPrefix].update = update;
    });

    // initialize
    const json = storage?.getItem(keyWithPrefix);
    if (json) {
      item.value = JSON.parse(json);
    } else if (init !== null && init !== undefined) {
      storage?.setItem(keyWithPrefix, JSON.stringify(init));
    }

    // proxy via getter/setter
    Object.defineProperty(reactive, key, {
      enumerable: true,
      get() {
        subscribe();
        return item.value;
      },
      set(newValue) {
        if (item.value === newValue) return;
        // console.log('set Storage:',key, newValue);
        item.value = newValue;
        if (!storage) return;
        if (newValue === null) {
          storage.removeItem(keyWithPrefix);
        } else {
          storage.setItem(keyWithPrefix, JSON.stringify(newValue));
        }
        item.update?.();
      },
    });
  }

  // implement reset method
  Object.defineProperty(reactive, "reset", {
    enumerable: false,
    writable: false,
    configurable: false,
    value: () => {
      for (const item of Object.values(items)) {
        // @ts-ignore
        reactive[item.key] = item.init;
      }
    },
  });

  // listen for storage changes from other documents
  if ("addEventListener" in globalThis) {
    globalThis.addEventListener("storage", (event) => {
      const { key: keyWithPrefix, storageArea, newValue } = event;
      if (!keyWithPrefix || !storageArea) return;
      // @ts-ignore
      const item = items[keyWithPrefix];
      if (!item || item.storage !== storageArea) return;
      item.value = JSON.parse(newValue || "null");
      item.update?.();
    });
  }

  return reactive;
}
