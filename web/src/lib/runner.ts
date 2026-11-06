// Client for the local runner (src/runner/server.ts). The page works read-only without it.
export interface RunnerEvent {
  id: number;
  ts: number;
  type: string;
  data: Record<string, any>;
}

const KEY = "anonai.runnerUrl";
export const runnerUrl = (): string => {
  try {
    return localStorage.getItem(KEY) || "http://localhost:8787";
  } catch {
    return "http://localhost:8787";
  }
};
export const setRunnerUrl = (u: string) => {
  try {
    localStorage.setItem(KEY, u);
  } catch {}
};

export async function runnerHealth(): Promise<{ ok: boolean; agents: string[]; busy: boolean } | null> {
  try {
    const r = await fetch(`${runnerUrl()}/health`, { signal: AbortSignal.timeout(2500) });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

export async function runnerPost<T = any>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${runnerUrl()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `runner ${r.status}`);
  return j;
}

export function subscribe(onEvent: (e: RunnerEvent) => void, since = 0): () => void {
  const es = new EventSource(`${runnerUrl()}/events?since=${since}`);
  const handler = (ev: MessageEvent) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {}
  };
  // EventSource only fires "message" for unnamed events; the runner names them, so listen generically.
  const types = ["act.start", "act.sync", "act.proving", "act.proved", "act.key", "act.built", "act.submitted", "act.included", "act.reverted", "act.rejected", "act.epochUsed", "act.prepared", "act.canonicalRejected", "act.canonicalAccepted", "heartbeat.start", "heartbeat.log", "heartbeat.done", "revoke.start", "revoke.log", "revoke.done", "agent.registering", "agent.log", "agent.registered", "fund.done", "treasury.done"];
  for (const t of types) es.addEventListener(t, handler as EventListener);
  return () => es.close();
}
