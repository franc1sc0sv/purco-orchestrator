import { useEffect, useState } from "react";

export type StreamStatus = "connecting" | "live" | "lost";

export const useStream = <T, D = never>(
  ticket: string | null,
  accept: (value: unknown) => value is T,
  merge?: { acceptDelta: (value: unknown) => value is D; apply: (current: T, delta: D) => T },
): { data: T | undefined; status: StreamStatus } => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [status, setStatus] = useState<StreamStatus>("connecting");

  useEffect(() => {
    setData(undefined);
    setStatus("connecting");
    const query = ticket === null ? "" : `?ticket=${encodeURIComponent(ticket)}`;
    const source = new EventSource(`/api/stream${query}`);
    source.onopen = () => setStatus("live");
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? "lost" : "connecting");
    source.addEventListener("snapshot", (event) => {
      const parsed: unknown = JSON.parse((event as MessageEvent<string>).data);
      if (accept(parsed)) setData(parsed);
      setStatus("live");
    });
    source.addEventListener("delta", (event) => {
      const parsed: unknown = JSON.parse((event as MessageEvent<string>).data);
      if (!merge?.acceptDelta(parsed)) return;
      setData((current) => (current === undefined ? current : merge.apply(current, parsed)));
    });
    return () => source.close();
  }, [ticket, accept, merge]);

  return { data, status };
};
