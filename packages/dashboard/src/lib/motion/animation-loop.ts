export type Tick = (dt: number, time: number) => void;

const FRAME_MS = 1000 / 60;
const MAX_DT_MS = 100;

const subscribers = new Set<Tick>();
let handle = 0;
let last = 0;

const frame = (now: number): void => {
  handle = requestAnimationFrame(frame);
  const elapsed = now - last;
  if (elapsed < FRAME_MS - 1) return;
  last = now;
  const dt = Math.min(elapsed, MAX_DT_MS) / 1000;
  for (const tick of subscribers) tick(dt, now / 1000);
};

const start = (): void => {
  if (handle !== 0 || document.hidden || subscribers.size === 0) return;
  last = performance.now();
  handle = requestAnimationFrame(frame);
};

const stop = (): void => {
  cancelAnimationFrame(handle);
  handle = 0;
};

document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

export const subscribe = (tick: Tick): (() => void) => {
  subscribers.add(tick);
  start();
  return () => {
    subscribers.delete(tick);
    if (subscribers.size === 0) stop();
  };
};
