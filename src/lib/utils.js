// @ts-nocheck

// import { clsx } from 'clsx';
// import { twMerge } from 'tailwind-merge';
import { typeOfP } from "./tools.svelte";

// /**
//  * @param {(string | boolean)[]} inputs
//  */
// export function cn(...inputs) {
// 	return twMerge(clsx(inputs));
// }

export function localNumString(num, digits = 2) {
  return parseFloat(num).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function createDeferredPromise() {
  let res, rej;
  const promise = new Promise((resolve, reject) => {
    res = resolve;
    rej = reject;
  });
  promise.resolve = res;
  promise.reject = rej;
  return promise;
}

/**
 * @param {string | number | Date | undefined} val
 */
export function localDayTime(val) {
  val = typeOfP(val).isDate ? val : new Date(val);
  const now = new Date();
  const nval = val.getTime() / 1000;
  const nnow = now.getTime() / 1000;

  const format = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  let diff = Math.floor((nnow - nval) / 60);

  // if (diff < 45 && now.getHours() == val.getHours()) delete format.hour;
  diff /= 60;
  if (diff >= 45 || now.getDate() != val.getDate()) {
    delete format.second;
    if (diff > 24 * 5 || now.getMonth() != val.getMonth()) {
      format.month = "numeric";
      format.day = "numeric";
      if (diff > 24 * 300) format.year = "numeric";
    } else format.weekday = "short";
  }
  // console.log('format', diff, format);
  return Intl.DateTimeFormat(undefined, format).format(val).replace(".,", "");
}

/** Converts ioB pattern into regex */
export function pattern2RegEx(pattern) {
  pattern = (pattern || "").toString();
  const startsWithWildcard = pattern[0] === "*";
  const endsWithWildcard = pattern[pattern.length - 1] === "*";
  pattern = pattern
    .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
    .replace(/\*/g, ".*");
  return RegExp(
    (startsWithWildcard ? "" : "^") + pattern + (endsWithWildcard ? "" : "$"),
  );
}

export function pattern2search(pattern, lowerCase = false) {
  pattern = (pattern || "").toString();
  if (lowerCase) pattern = pattern.toLowerCase();
  // const startsWithWildcard = pattern[0] === '*';
  // const endsWithWildcard = pattern[pattern.length - 1] === '*';
  return RegExp(
    pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*"),
  );
  // return (startsWithWildcard ? '' : '^') + pattern + (endsWithWildcard ? '' : '$');
}
