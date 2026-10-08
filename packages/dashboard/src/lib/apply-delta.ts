import type { TicketDelta, TicketDetail } from "@/lib/types";

const MAX_EVENTS = 500;
const MAX_SAMPLES = 6000;

export const applyDelta = (current: TicketDetail, delta: TicketDelta): TicketDetail => {
  const { events, samples, ...parts } = delta;
  return {
    ...current,
    ...parts,
    events: [...current.events, ...events].slice(-MAX_EVENTS),
    samples: [...current.samples, ...samples].slice(-MAX_SAMPLES),
  };
};
