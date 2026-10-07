import { burnLevel } from "./burn-map";
import { fbm2 } from "./noise";

export const FIELD_SCALE = 0.0035;

export const fieldAngle = (x: number, y: number, time: number): number =>
  fbm2(x * FIELD_SCALE, y * FIELD_SCALE + time * 0.04) * Math.PI * 2;

export const fieldSpeed = (rate: number, elapsedFraction: number): number => {
  const clamped = Math.min(1, Math.max(0, elapsedFraction));
  return (10 + 110 * burnLevel(rate)) * (1 + 2.5 * clamped * clamped);
};
