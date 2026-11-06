// Data access for the dashboard: the exported public facts (anonai.json), ethrex reads through viem, and the
// sidecar explorer API. Everything runs in the browser; both devnet routes send permissive CORS headers.
import { createPublicClient, defineChain, formatEther, http, type Address, type Hex } from "viem";
import { pageFetch } from "./anon";

export interface Facts {
  generatedAt: string;
  chainId: number;
  gatewayUrl: string;
  minerUrl: string;
  ethrexUrl: string;
  explorerUrl: string;
  stakingRegistry: Address;
  recentRootAddress: Address;
  nonceManager: Address;
  weth: Address;
  poseidonT3: Address;
  deployments: { verifier?: Address; keystore?: Address; account?: Address; paymaster?: Address };
  operator?: Address | null;
  policies: { name: string; policyClass: Hex; target: Address; selector: Hex; maxAmount: string; maxValue: string }[];
  agents: { name: string; mode: "zk" | "key"; policyName: string; policyClass: Hex; commitment: string | null; keys: number | null; used: number | null }[];
  demoRecipient: Address;
}

export async function loadFacts(): Promise<Facts> {
  const r = await fetch("./anonai.json", { cache: "no-store" });
  if (!r.ok) throw new Error("anonai.json missing: run `yarn export:web` in the repo root");
  return r.json();
}

export const client = (f: Facts) =>
  createPublicClient({
    chain: defineChain({ id: f.chainId, name: "altmempool-devnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [f.ethrexUrl] } } }),
    // every chain read goes through pageFetch, so enabling Anon-RPC covers viem's calls too
    transport: http(f.ethrexUrl, { fetchFn: pageFetch }),
  });

export async function rpc<T = any>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await pageFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

export const ERC20_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
export const REGISTRY_ABI = [{ type: "function", name: "getDepositInfo", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }, { type: "uint32" }, { type: "uint64" }] }] as const;
export const KEYSTORE_ABI = [
  { type: "function", name: "members", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "generation", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint32" }] },
  { type: "function", name: "rootSeq", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "root", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
] as const;
export const PAYMASTER_ABI = [{ type: "function", name: "budget", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] }] as const;

export interface Overview {
  block: number;
  account: { eth: string; weth: string; stake: string };
  paymaster: { eth: string; stake: string };
  classes: { name: string; policyClass: Hex; members: number; slots: number; epoch: string; generation: number; root: string; budget: string }[];
}

export async function loadOverview(f: Facts): Promise<Overview> {
  const c = client(f);
  const { account, paymaster, keystore } = f.deployments;
  if (!account || !paymaster || !keystore) throw new Error("not deployed");
  const stakeOf = async (a: Address) => {
    try {
      const [amount] = (await c.readContract({ address: f.stakingRegistry, abi: REGISTRY_ABI, functionName: "getDepositInfo", args: [a] })) as readonly [bigint, number, bigint];
      return formatEther(amount);
    } catch {
      return "0";
    }
  };
  const [block, accEth, accWeth, accStake, pmEth, pmStake] = await Promise.all([
    c.getBlockNumber(),
    c.getBalance({ address: account }),
    c.readContract({ address: f.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [account] }) as Promise<bigint>,
    stakeOf(account),
    c.getBalance({ address: paymaster }),
    stakeOf(paymaster),
  ]);
  const classes = await Promise.all(
    f.policies.map(async (p) => {
      const [members, generation, epoch, root, budget] = await Promise.all([
        c.readContract({ address: keystore, abi: KEYSTORE_ABI, functionName: "members", args: [p.policyClass] }) as Promise<readonly bigint[]>,
        c.readContract({ address: keystore, abi: KEYSTORE_ABI, functionName: "generation", args: [p.policyClass] }) as Promise<number>,
        c.readContract({ address: keystore, abi: KEYSTORE_ABI, functionName: "rootSeq", args: [p.policyClass] }) as Promise<bigint>,
        c.readContract({ address: keystore, abi: KEYSTORE_ABI, functionName: "root", args: [p.policyClass] }) as Promise<bigint>,
        c.readContract({ address: paymaster, abi: PAYMASTER_ABI, functionName: "budget", args: [p.policyClass] }) as Promise<bigint>,
      ]);
      return { name: p.name, policyClass: p.policyClass, members: members.filter((m) => m !== 0n).length, slots: members.length, epoch: epoch.toString(), generation: Number(generation), root: `0x${root.toString(16).padStart(64, "0")}`, budget: formatEther(budget) };
    }),
  );
  return { block: Number(block), account: { eth: formatEther(accEth), weth: formatEther(accWeth), stake: accStake }, paymaster: { eth: formatEther(pmEth), stake: pmStake }, classes };
}

export interface Admission {
  txHash: Hex;
  sender: string;
  nonceKeys: string[];
  at: number;
  outcome: string;
  errorCode?: number;
  checks: { rule: string; verdict: string; entity?: string; detail?: string; frameIndex?: number }[];
  frameStatuses?: string[];
  source?: string;
  errorMessage?: string;
}

/** Admissions of the shared account as the gateway saw them, newest first. */
export async function loadFeed(f: Facts, limit = 50): Promise<Admission[]> {
  const account = f.deployments.account?.toLowerCase();
  const page = await rpc<{ items: any[] }>(f.gatewayUrl, "skandha_explorer_listAdmissions", [{ limit }]);
  const items: any[] = page?.items ?? (Array.isArray(page) ? (page as any) : []);
  return items
    .map((it) => (it.admission ? { ...it.admission, txHash: it.txHash ?? it.admission.txHash } : it))
    .filter((a) => !account || String(a.sender ?? "").toLowerCase() === account) as Admission[];
}

export async function loadReceipt(f: Facts, hash: Hex) {
  return rpc(f.ethrexUrl, "eth_getTransactionReceipt", [hash]);
}

/** zk if the nonce key does not fit an address: nullifiers are field elements, one-time keys are addresses. */
export const modeOfNonceKey = (k: string | undefined): "zk" | "key" | "linear" => {
  if (!k) return "linear";
  const v = BigInt(k);
  if (v === 0n) return "linear";
  return v < 1n << 160n ? "key" : "zk";
};

export const short = (s: string, n = 6) => (s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s);
