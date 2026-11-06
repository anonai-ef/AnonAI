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

/** Deploys creation bytecode with a legacy tx from `key`. `value` funds the contract through CREATE (a later transfer would hit its fallback). */
export async function deploy(key: Hex, bytecode: Hex, value = 0n, gas?: bigint): Promise<Address> {
  const w = walletClient(key);
  const hash = await w.sendTransaction({ data: bytecode, value, gas: gas ?? cfg().deployGasLimit, gasPrice: cfg().legacyGasPriceWei });
  const r = await waitMined(hash);
  if (r.status !== "0x1" || !r.contractAddress) throw new Error(`DEPLOY_FAILED: ${hash}`);
  return r.contractAddress as Address;
}

/** A plain legacy call from `key` (owner-side admin calls: fund, addAgent, commit root). */
export async function sendLegacy(key: Hex, to: Address, data: Hex, value = 0n, gas = 500_000n): Promise<Hex> {
  const hash = await walletClient(key).sendTransaction({ to, data, value, gas, gasPrice: cfg().legacyGasPriceWei });
  const r = await waitMined(hash);
  if (r.status !== "0x1") throw new Error(`TX_REVERTED: ${hash}`);
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
