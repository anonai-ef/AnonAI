// Owner-side operations shared by the CLI and the local runner: register, revoke, heartbeat, fund, treasury.
import { encodeFunctionData, formatEther, parseEther, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { publicClient, sendLegacy } from "./chain.js";
import { artifact } from "./contracts.js";
import { leafOfAddress, oneTimeKeys } from "./keys.js";
import { KeystoreClient } from "./keystoreClient.js";
import { policyByName } from "./policies.js";
import { commitmentOf, siblingsOf } from "./semaphore.js";
import { operatorKey, readState, requireDeployment, writeState, type AgentRecord } from "./state.js";
import { wethBalance, wrapAndSend } from "./weth.js";

export type Log = (s: string) => void;
const quiet: Log = () => {};

const keystore = () => new KeystoreClient(requireDeployment("keystore"));

export async function registerAgent(a: { name: string; mode: "zk" | "key"; policyName: string; keys?: number }, log: Log = quiet): Promise<AgentRecord & { txHash: Hex; epoch: string }> {
  if (readState().agents[a.name]) throw new Error(`agent ${a.name} exists`);
  const { policyClass } = policyByName(a.policyName);
  const secret = generatePrivateKey();
  const ks = keystore();
  if (a.mode === "zk") {
    const commitment = commitmentOf(secret);
    log(`registering ${a.name} (zk) in ${a.policyName}: commitment ${commitment}`);
    const r = await ks.register(operatorKey(), policyClass, [commitment]);
    const rec: AgentRecord = { name: a.name, mode: "zk", secret, policyName: a.policyName, policyClass, commitment: commitment.toString() };
    writeState((s) => (s.agents[a.name] = rec));
    return { ...rec, txHash: r.txHash, epoch: r.seq.toString() };
  }
  const n = a.keys ?? 8;
  const keys = oneTimeKeys(secret, n);
  log(`registering ${a.name} (key) in ${a.policyName}: ${n} one-time keys`);
  const r = await ks.register(operatorKey(), policyClass, keys.map((k) => leafOfAddress(k.address)));
  const rec: AgentRecord = { name: a.name, mode: "key", secret, policyName: a.policyName, policyClass, keys: n, used: 0 };
  writeState((s) => (s.agents[a.name] = rec));
  return { ...rec, txHash: r.txHash, epoch: r.seq.toString() };
}

export async function revokeAgent(name: string, log: Log = quiet): Promise<{ txHashes: Hex[]; generation: number }> {
  const rec = readState().agents[name];
  if (!rec) throw new Error(`unknown agent ${name}`);
  const ks = keystore();
  const hashes: Hex[] = [];
  if (rec.mode === "zk") {
    const members = await ks.members(rec.policyClass);
    const leaf = BigInt(rec.commitment!);
    if (members.includes(leaf)) {
      const r = await ks.revoke(operatorKey(), rec.policyClass, leaf, siblingsOf(members, leaf));
      hashes.push(r.txHash);
      log(`revoked ${name} in tx ${r.txHash}`);
    }
  } else {
    for (const k of oneTimeKeys(rec.secret, rec.keys!).slice(rec.used ?? 0)) {
      const members = await ks.members(rec.policyClass);
      const leaf = leafOfAddress(k.address);
      if (!members.includes(leaf)) continue;
      const r = await ks.revoke(operatorKey(), rec.policyClass, leaf, siblingsOf(members, leaf));
      hashes.push(r.txHash);
      log(`revoked key #${k.index} in tx ${r.txHash}`);
    }
    writeState((s) => (s.agents[name].used = s.agents[name].keys));
  }
  return { txHashes: hashes, generation: await ks.generation(rec.policyClass) };
}

/** Opens a new epoch for the class, waiting for the Keystore's heartbeat spacing if needed. */
export async function heartbeat(policyName: string, log: Log = quiet): Promise<{ txHash: Hex; epoch: string; slot: string }> {
  const { policyClass } = policyByName(policyName);
  const ks = keystore();
  const last = await ks.lastCommitBlock(policyClass);
  const spacing = await ks.epochBlocks();
  const head = await publicClient().getBlockNumber();
  if (head < last + spacing) {
    const wait = Number(last + spacing - head);
    log(`heartbeat allowed at block ${last + spacing}; waiting ~${wait * 6}s`);
    await new Promise((r) => setTimeout(r, (wait + 1) * 6000));
  }
  const r = await ks.heartbeat(operatorKey(), policyClass);
  log(`heartbeat for ${policyName}: epoch ${r.seq} (tx ${r.txHash})`);
  return { txHash: r.txHash, epoch: r.seq.toString(), slot: r.recentRoot.slot.toString() };
}

export async function fundBudget(policyName: string, eth: string): Promise<Hex> {
  const { policyClass } = policyByName(policyName);
  const data = encodeFunctionData({ abi: artifact("BudgetPaymaster").abi, functionName: "fund", args: [policyClass] });
  return sendLegacy(operatorKey(), requireDeployment("paymaster"), data, parseEther(eth));
}

export async function budgetOf(policyName: string): Promise<bigint> {
  const { policyClass } = policyByName(policyName);
  return (await publicClient().readContract({ address: requireDeployment("paymaster"), abi: artifact("BudgetPaymaster").abi, functionName: "budget", args: [policyClass] })) as bigint;
}

export async function topUpTreasury(eth: string): Promise<{ deposit: Hex; transfer: Hex; treasuryWeth: string }> {
  const account = requireDeployment("account");
  const r = await wrapAndSend(operatorKey(), account, parseEther(eth));
  return { ...r, treasuryWeth: formatEther(await wethBalance(account)) };
}
