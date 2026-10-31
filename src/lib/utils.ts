export interface DeferredPromise<T> extends Promise<T> {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export function createDeferredPromise<T = unknown>(): DeferredPromise<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  }) as DeferredPromise<T>;
  promise.resolve = resolve;
  promise.reject = reject;
  return promise;
}

export function localNumString(num: number | string, digits = 2): string {
  return parseFloat(String(num)).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A time for a log/list row: today shows the clock, older shows the date. */
export function localDayTime(val: string | number | Date | undefined): string {
  const date = val instanceof Date ? val : new Date(val as string | number);
  const now = new Date();
  const format: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  let diff = Math.floor((now.getTime() / 1000 - date.getTime() / 1000) / 60);

  diff /= 60;
  if (diff >= 45 || now.getDate() !== date.getDate()) {
    delete format.second;
    if (diff > 24 * 5 || now.getMonth() !== date.getMonth()) {
      format.month = "numeric";
      format.day = "numeric";
      if (diff > 24 * 300) format.year = "numeric";
    } else {
      format.weekday = "short";
    }
  }
  return Intl.DateTimeFormat(undefined, format).format(date).replace(".,", "");
}

/** Converts an ioBroker pattern (`*` wildcards) into an anchored regex. */
export function pattern2RegEx(pattern: unknown): RegExp {
  const text = String(pattern ?? "");
  const startsWithWildcard = text[0] === "*";
  const endsWithWildcard = text[text.length - 1] === "*";
  const body = text
    .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
    .replace(/\*/g, ".*");
  return RegExp(
    (startsWithWildcard ? "" : "^") + body + (endsWithWildcard ? "" : "$"),
  );
}

/** The same conversion without anchoring — a search pattern for filters. */
export function pattern2search(pattern: unknown, lowerCase = false): RegExp {
  let text = String(pattern ?? "");
  if (lowerCase) text = text.toLowerCase();
  return RegExp(
    text.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*"),
  );
}
