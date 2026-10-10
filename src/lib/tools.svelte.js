// @ts-nocheck
import { SvelteDate } from "svelte/reactivity";
import { createReactiveStorage } from "./localStorage.js";
import { setContext, getContext } from "svelte";

/**
 * @param {any} x
 */
export function typeOf(x) {
  if (x === void 0) return "undefined";
  if (x === null) return "null";
  if (x === true) return "boolean";
  if (x === false) return "boolean";
  if (x === Number.NaN) return "NaN";
  if (typeof x === "number") return "number";
  if (typeof x === "string") return "string";
  if (typeof x === "function") return "function";
  if (typeof x === "object") {
    if (Array.isArray(x)) return "array";
    if (x.constructor && x.constructor.name) return x.constructor.name;
    return "object";
  }
}

/**
 * @param {any} x
 */
export function typeOfP(x) {
  return new Proxy(
    {},
    {
      get(target, propKey, receiver) {
        // console.log('get typeofP', propKey, receiver, target);
        switch (propKey) {
          case "isString":
            return typeof x === "string";
          case "isNumber":
            return typeof x === "number";
          case "isBoolean":
            return typeof x === "boolean";
          case "isArray":
            return Array.isArray(x);
          case "isFunction":
            return typeof x === "function";
          case "isObject":
            return (
              typeof x === "object" &&
              (!x.constructor || x.constructor.name === "Object")
            );
          case "isUndefined":
            return typeof x === void 0;
          case "isNull":
            return x === null;
          case "isNaN":
            return Number.isNaN(x);
          case "isSymbol":
            return x.constructor?.name === "Symbol";
          case "isDate":
            return x instanceof Date;
          case "isRegExp":
            return x instanceof RegExp;
          default:
          case "class":
            return x === null
              ? "null"
              : x === void 0
                ? "undefined"
                : x.constructor && x.constructor.name;
        }
      },
    },
  );
}

export function getVisibility() {
  const { readyState, visibilityState } = document;
  return {
    readyState,
    visibilityState,
    visible: visibilityState === "visible" || readyState === "interactive",
  };
}

export let visibilityState = $state(getVisibility());

export const currentTime = new SvelteDate();

/**
 * @param {number | Date} age
 */
export function ageString(age) {
  if (age instanceof Date) age = age.getTime();
  if (typeof age !== "number" || isNaN(age)) return "";
  if (age < 0) age = Date.now() + age;
  // if (age < 1000) return `${age}ms`;
  if (age < 4000) return `now`;
  if (age < 60 * 1000) return `${Math.round(age / 1000)}s`;
  if (age < 60 * 60 * 1000) return `${Math.round(age / (60 * 1000))}m`;
  if (age < 24 * 60 * 60 * 1000)
    return `${Math.round(age / (60 * 60 * 1000))}h`;
  return `${Math.round(age / (24 * 60 * 60 * 1000))}d`;
}

/**
 * @param {any} item
 */
export function niceJson(item, tabsize = 2) {
  if (item === undefined) return "undefined";
  return JSON.stringify(item, null, tabsize);
}

// @ts-ignore
const _SvelteDate = SvelteDate.prototype;
const _Date = Date.prototype;

// @ts-ignore
if (!Date.hasOwnProperty("age"))
  // @ts-ignore
  _Date.age = function (age) {
    if (age instanceof Date) age = age.getTime();
    if (typeof age !== "number" || isNaN(age)) return NaN;
    const now = this.getTime();
    if (age < 0) age = now + age;
    else age = age > now ? age - now : now - age;
    return age;
  };
// @ts-ignore
if (!Date.hasOwnProperty("ageString"))
  // @ts-ignore
  _Date.ageString = function (oage) {
    // console.log ('fAgeString', this.constructor.name, !!this.age, oage);
    if (oage instanceof Date) oage = oage.getTime();
    // @ts-ignore
    else if (typeof oage !== "number" || isNaN(oage))
      oage = this.age(Date.now());
    // @ts-ignore
    return typeof this.age !== "function"
      ? ageString(oage)
      : ageString(this.age(oage));
  };

/**
 * @param {any} obj
 * @param {string} name
 */
export function getSelector(obj, name) {
  if (!name || !obj) return null;
  let data = obj;
  for (let spath of name.split(".")) {
    if (!data || !spath) break;
    data = data[spath];
  }
  return data;
}

const APPSTORAGE = Symbol("APPSTORAGE");
let storage = $state(createReactiveStorage());
/**
 * Accepts any number of item definitions (tuples) plus an optional trailing
 * config object, and forwards them to createReactiveStorage(values, config).
 * @param {any[]} options
 */
export function defineStorage(...options) {
  const values = [];
  let config = {};
  for (const opt of options) {
    if (Array.isArray(opt)) values.push(opt);
    else if (opt && typeof opt === "object") config = { ...config, ...opt };
  }
  storage = createReactiveStorage(values, config);

  return setContext(APPSTORAGE, storage);
}

export function getStorage() {
  return getContext(APPSTORAGE);
}
