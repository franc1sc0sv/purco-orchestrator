import { useEffect, useState } from "react";

export type StreamStatus = "connecting" | "live" | "lost";

export const useStream = <T>(
  ticket: string | null,
  accept: (value: unknown) => value is T,
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
    return () => source.close();
  }, [ticket, accept]);

  return { data, status };
};
