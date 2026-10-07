import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { subscribe } from "@/lib/motion/animation-loop";
import { readBluePalette, type BluePalette } from "@/lib/motion/palette";

export type Frame = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dt: number;
  time: number;
  animated: boolean;
  palette: BluePalette;
};

export const useCanvas = (
  render: (frame: Frame) => void,
  options: { persist?: boolean } = {},
): RefObject<HTMLCanvasElement | null> => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderRef = useRef(render);
  const redrawRef = useRef<() => void>(() => undefined);
  const reduced = useReducedMotion();
  const persist = options.persist ?? false;

  useLayoutEffect(() => {
    renderRef.current = render;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let palette = readBluePalette();
    let width = 0;
    let height = 0;
    let dpr = 1;

    const draw = (dt: number, time: number): void => {
      if (width === 0 || height === 0) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!persist) ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      renderRef.current({ ctx, width, height, dt, time, animated: !reduced, palette });
    };

    const resize = (): void => {
      dpr = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (reduced) draw(0, 0);
    };

    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(() => {
      palette = readBluePalette();
      if (reduced) draw(0, 0);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    resize();
    redrawRef.current = () => draw(0, 0);
    const unsubscribe = reduced ? () => undefined : subscribe(draw);
    return () => {
      unsubscribe();
      sizeObserver.disconnect();
      themeObserver.disconnect();
      redrawRef.current = () => undefined;
    };
  }, [reduced, persist]);

  useEffect(() => {
    if (reduced) redrawRef.current();
  });

  return canvasRef;
};
