// Anon-RPC for the dashboard's reads. When enabled, every JSON-RPC and explorer request the page makes leaves
// through a hash-pinned anonymising worker (Tor by default) running in the harness's null-origin iframe, so the
// devnet's RPC providers see an exit address instead of this browser. The one exempt read is the harness's own
// bootstrap lookup of the specifier contract (the spec exempts it; it reveals only that a specifier was read).
import { AnonRpcWorker } from "@anon-rpc/browser-harness";

export type NetworkId = "tor-js" | "nym" | "passthrough";
export const NETWORKS: Record<NetworkId, { address: string; config?: unknown; label: string; note: string }> = {
  "tor-js": {
    address: "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e",
    config: { gateways: ["152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ"] },
    label: "Tor",
    note: "a Tor client in WebAssembly; the provider sees a Tor exit. Bootstrap takes a while and each request is slower.",
  },
  nym: { address: "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0", label: "Nym mixnet", note: "requests leave at a Nym IP packet router; ~18 MB bundle." },
  passthrough: { address: "0x4fd77be300f31c5fe6ab266d35d27750a3478d27", label: "passthrough (test)", note: "plain fetch inside the sandbox: NOT anonymised, only proves the pipeline." },
};
/** Mainnet, where the specifier contracts live. Used once per session to read workerHash() and workerResolvers(). */
const BOOTSTRAP_RPC = "https://ethereum-rpc.publicnode.com";

export interface AnonState {
  enabled: boolean;
  network: NetworkId;
  status: "off" | "booting" | "ready" | "error";
  error?: string;
  requests: number;
  direct: number;
  logs: string[];
}

let worker: AnonRpcWorker | null = null;
let state: AnonState = { enabled: false, network: "tor-js", status: "off", requests: 0, direct: 0, logs: [] };
const listeners = new Set<(s: AnonState) => void>();
const set = (patch: Partial<AnonState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
};
export const getAnonState = () => state;
export const subscribeAnon = (l: (s: AnonState) => void) => {
  listeners.add(l);
  l(state);
  return () => {
    listeners.delete(l);
  };
};

export function enableAnon(network: NetworkId = "tor-js") {
  disableAnon();
  const n = NETWORKS[network];
  set({ enabled: true, network, status: "booting", error: undefined, logs: [] });
  try {
    worker = new AnonRpcWorker({
      address: n.address,
      config: n.config,
      preExisting: {
        rpcProvider: {
          request: async ({ method, params }: { method: string; params?: unknown[] }) => {
            const r = await fetch(BOOTSTRAP_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }) });
            const j = await r.json();
            if (j.error) throw new Error(j.error.message);
            return j.result;
          },
        },
      },
    } as any);
    const w = worker;
    w.ready.then(() => worker === w && set({ status: "ready" })).catch((e) => worker === w && set({ status: "error", error: (e as Error).message }));
    (async () => {
      for (;;) {
        try {
          const entry: any = await w.acceptLog();
          if (worker !== w) return;
          const line = typeof entry === "string" ? entry : entry.message ?? JSON.stringify(entry);
          set({ logs: [...state.logs.slice(-29), line] });
        } catch {
          return;
        }
      }
    })();
  } catch (e) {
    set({ status: "error", error: (e as Error).message });
  }
}

export function disableAnon() {
  try {
    worker?.close();
  } catch {}
  worker = null;
  set({ enabled: false, status: "off", error: undefined });
}

/** The page's fetch: anonymised when a worker is enabled and healthy, direct otherwise (and counted either way). */
export const pageFetch: typeof fetch = (input, init) => {
  if (worker && state.enabled && state.status !== "error") {
    set({ requests: state.requests + 1 });
    return worker.fetch(input as any, init as any) as Promise<Response>;
  }
  set({ direct: state.direct + 1 });
  return fetch(input, init);
};
