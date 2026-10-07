import { useRef } from "react";
import { useCanvas, type Frame } from "@/hooks/use-canvas";
import { approach } from "@/lib/motion/burn-map";
import { fieldAngle, fieldSpeed } from "@/lib/motion/flow-field";
import { cn } from "@/lib/utils";

type Particle = { x: number; y: number; px: number; py: number; pace: number };

const PARTICLE_COUNT = 320;
const STATIC_STREAMLINES = 70;
const STATIC_STEPS = 36;
const STATIC_STEP_PX = 7;
const SMOOTHING_SECONDS = 1.2;

const spawn = (width: number, height: number): Particle => {
  const x = Math.random() * width;
  const y = Math.random() * height;
  return { x, y, px: x, py: y, pace: 0.7 + Math.random() * 0.6 };
};

const drawStatic = ({ ctx, width, height, palette }: Frame): void => {
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  for (let line = 0; line < STATIC_STREAMLINES; line++) {
    let x = ((line * 0.6180339887) % 1) * width;
    let y = ((line * 0.7548776662) % 1) * height;
    ctx.moveTo(x, y);
    for (let step = 0; step < STATIC_STEPS; step++) {
      const angle = fieldAngle(x, y, 0);
      x += Math.cos(angle) * STATIC_STEP_PX;
      y += Math.sin(angle) * STATIC_STEP_PX;
      ctx.lineTo(x, y);
    }
  }
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = palette.mid;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
};

export const FlowField = ({
  rate,
  elapsedFraction,
  className,
}: {
  rate: number;
  elapsedFraction: number;
  className?: string;
}) => {
  const inputRef = useRef({ rate, elapsedFraction });
  const stateRef = useRef({ smoothed: rate, particles: [] as Particle[] });
  inputRef.current = { rate, elapsedFraction };

  const render = (frame: Frame): void => {
    if (!frame.animated) {
      drawStatic(frame);
      return;
    }
    const { ctx, width, height, dt, time, palette } = frame;
    const state = stateRef.current;
    const input = inputRef.current;
    state.smoothed = approach(state.smoothed, input.rate, dt, SMOOTHING_SECONDS);
    if (state.particles.length === 0) {
      state.particles = Array.from({ length: PARTICLE_COUNT }, () => spawn(width, height));
    }
    const speed = fieldSpeed(state.smoothed, input.elapsedFraction);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    const trails = new Path2D();
    for (let index = 0; index < state.particles.length; index++) {
      const particle = state.particles[index];
      if (!particle) continue;
      particle.px = particle.x;
      particle.py = particle.y;
      const angle = fieldAngle(particle.x, particle.y, time);
      particle.x += Math.cos(angle) * speed * particle.pace * dt;
      particle.y += Math.sin(angle) * speed * particle.pace * dt;
      const outside = particle.x < 0 || particle.x > width || particle.y < 0 || particle.y > height;
      if (outside) state.particles[index] = spawn(width, height);
      else {
        trails.moveTo(particle.px, particle.py);
        trails.lineTo(particle.x, particle.y);
      }
    }
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = palette.mid;
    ctx.lineWidth = 1.4;
    ctx.stroke(trails);
    ctx.globalAlpha = 1;
  };

  const canvasRef = useCanvas(render, { persist: true });

  return <canvas ref={canvasRef} className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
};
