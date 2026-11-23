export interface LongPressOptions {
  /** How long the finger must stay down. */
  delay?: number;
  /** Movement up to this many pixels still counts as a press, not a scroll. */
  tolerance?: number;
  /** Called with the press's start point, once. */
  onTrigger: (x: number, y: number) => void;
}

export interface LongPress {
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(): void;
  cancel(): void;
  /** True once the last press fired, until the next `down`. */
  readonly triggered: boolean;
  /** Take the trigger flag: true once after a long-press, then false. */
  consume(): boolean;
}

/** A touch long-press: fires once after `delay`, unless the finger moves away
 *  (a scroll) or lifts early. The caller swallows the click it produces. */
export function createLongPress({
  delay = 500,
  tolerance = 8,
  onTrigger,
}: LongPressOptions): LongPress {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let down = false;
  let triggered = false;

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    down(x, y) {
      clear();
      startX = x;
      startY = y;
      down = true;
      triggered = false;
      timer = setTimeout(() => {
        timer = null;
        if (!down) return;
        down = false;
        triggered = true;
        onTrigger(startX, startY);
      }, delay);
    },
    move(x, y) {
      if (!down) return;
      if (Math.hypot(x - startX, y - startY) > tolerance) {
        clear();
        down = false;
      }
    },
    up() {
      clear();
      down = false;
    },
    cancel() {
      clear();
      down = false;
    },
    get triggered() {
      return triggered;
    },
    consume() {
      const fired = triggered;
      triggered = false;
      return fired;
    },
  };
}
