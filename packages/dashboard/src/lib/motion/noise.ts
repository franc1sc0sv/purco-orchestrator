const hash = (x: number, y: number): number => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const fade = (value: number): number => value * value * (3 - 2 * value);

export const noise2 = (x: number, y: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * fx;
  const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * fx;
  return (top + (bottom - top) * fy) * 2 - 1;
};

export const fbm2 = (x: number, y: number): number =>
  noise2(x, y) * 0.65 + noise2(x * 2.1 + 17.3, y * 2.1 - 9.7) * 0.35;
