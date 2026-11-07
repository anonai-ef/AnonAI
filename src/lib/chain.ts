// Chain reads and ordinary (non-frame) transactions: deployments, funding, waiting for receipts.
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config.js";
import { rpc } from "./rpc.js";

const cfg = () => loadConfig();

export const devnet = () =>
  defineChain({
    id: cfg().chainId,
    name: "altmempool-devnet",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg().ethrexUrl] } },
  });

export const publicClient = () => createPublicClient({ chain: devnet(), transport: http(cfg().ethrexUrl) });
export const walletClient = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: devnet(), transport: http(cfg().ethrexUrl) });

export const balance = (a: Address) => publicClient().getBalance({ address: a });
export const code = (a: Address) => publicClient().getCode({ address: a });
export const storage = (a: Address, slot: Hex) => publicClient().getStorageAt({ address: a, slot });

/** Waits for a receipt from ethrex. Frame transactions report per-frame results in `frameReceipts`. */
export async function waitMined(hash: Hex): Promise<any> {
  const deadline = Date.now() + cfg().txTimeoutSec * 1000;
  while (Date.now() < deadline) {
    const r = await rpc<any>(cfg().ethrexUrl, "eth_getTransactionReceipt", [hash]);
    if (r) return r;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`TX_NOT_MINED: ${hash} not mined within ${cfg().txTimeoutSec}s`);
}

/**
 * Waits until every alt-mempool sidecar reports a head at or past `block`. Each sidecar simulates against its own
 * node, which can trail ethrex by a block; a transaction that depends on a fresh Keystore root (heartbeat, register,
 * revoke) is otherwise rejected with a misleading "prefix gas budget exceeded ... (MAX_VERIFY_GAS)". A sidecar that
 * does not answer is skipped rather than waited on.
 */
export async function waitSidecarsAt(block: bigint, timeoutMs = 60_000): Promise<void> {
  const urls = [...new Set([cfg().gatewayUrl, cfg().minerUrl].filter(Boolean))] as string[];
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(urls);
  while (pending.size && Date.now() < deadline) {
    for (const u of [...pending]) {
      try {
        if (BigInt(await rpc<Hex>(u, "eth_blockNumber", [])) >= block) pending.delete(u);
      } catch {
        pending.delete(u);
      }
    }
    if (pending.size) await new Promise((r) => setTimeout(r, 1500));
  }
}

/** The next head seen by the sidecars, for retrying a submission that raced a block. */
export async function waitSidecarsNextBlock(): Promise<void> {
  const head = BigInt(await rpc<Hex>(cfg().ethrexUrl, "eth_blockNumber", []));
  await waitSidecarsAt(head + 1n, 30_000);
}

/**
 * Gas for an ordinary transaction: the node's estimate plus 25%, capped by `heavyDeployGasLimit`. This devnet charges
 * state gas for code deposits, so a 23 KB contract estimates at ~38M gas while blocks allow 60M; fixed limits fail.
 */
async function gasFor(from: Address, to: Address | undefined, data: Hex, value: bigint): Promise<bigint> {
  const est = await publicClient().estimateGas({ account: from, to, data, value });
  const withMargin = (est * 125n) / 100n;
  return withMargin > cfg().heavyDeployGasLimit ? cfg().heavyDeployGasLimit : withMargin;
}

/** Deploys creation bytecode with a legacy tx from `key`. `value` funds the contract through CREATE (a later transfer would hit its fallback). */
export async function deploy(key: Hex, bytecode: Hex, value = 0n, gas?: bigint): Promise<Address> {
  const w = walletClient(key);
  const from = privateKeyToAccount(key).address;
  const hash = await w.sendTransaction({ data: bytecode, value, gas: gas ?? (await gasFor(from, undefined, bytecode, value)), gasPrice: cfg().legacyGasPriceWei });
  const r = await waitMined(hash);
  if (r.status !== "0x1" || !r.contractAddress) throw new Error(`DEPLOY_FAILED: ${hash} (gas used ${parseInt(r.gasUsed)})`);
  return r.contractAddress as Address;
}

/** A plain legacy call from `key` (owner-side admin calls: fund, register, commit root). */
export async function sendLegacy(key: Hex, to: Address, data: Hex, value = 0n, gas?: bigint): Promise<Hex> {
  const from = privateKeyToAccount(key).address;
  const hash = await walletClient(key).sendTransaction({ to, data, value, gas: gas ?? (await gasFor(from, to, data, value)), gasPrice: cfg().legacyGasPriceWei });
  const r = await waitMined(hash);
  if (r.status !== "0x1") throw new Error(`TX_REVERTED: ${hash} (gas used ${parseInt(r.gasUsed)})`);
  return hash;
}

/** Asks the devnet faucet (1 ETH, once per address per hour) and waits for it to land. */
export async function faucet(to: Address): Promise<Hex> {
  const r = await rpc<{ txHash: Hex }>(cfg().gatewayUrl, "skandha_explorer_faucet", [to]);
  await waitMined(r.txHash);
  return r.txHash;
}

export const latestSlot = async (): Promise<bigint> => BigInt((await rpc<any>(cfg().ethrexUrl, "eth_getBlockByNumber", ["latest", false])).slotNumber);
export const blockSlot = async (blockNumber: Hex): Promise<bigint> => BigInt((await rpc<any>(cfg().ethrexUrl, "eth_getBlockByNumber", [blockNumber, false])).slotNumber);
