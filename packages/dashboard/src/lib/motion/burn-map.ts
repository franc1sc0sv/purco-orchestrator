export const BURN_SATURATION = 150_000;

export const burnLevel = (rate: number): number =>
  rate <= 0 ? 0 : Math.min(1, Math.log10(1 + rate) / Math.log10(1 + BURN_SATURATION));

export const approach = (current: number, target: number, dt: number, tau: number): number =>
  current + (target - current) * (1 - Math.exp(-dt / tau));

