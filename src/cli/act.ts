// yarn act <agent> <to> <weth-amount> [--canonical] [--estimate] [--prepare <file>]
// yarn act --send-prepared <file>
// Sends one agent action: a WETH transfer from the shared account, authorised in the agent's mode (zk or key),
// paid by the paymaster. --canonical sends the identical bytes to ethrex's own mempool instead (expected: rejected).
// --prepare builds and signs/proves the transaction but writes it to a file instead of sending; --send-prepared
// sends such a file later (demo: prepare before a revocation, send after it, watch frame 0 refuse the old root).
import fs from "node:fs";
import { formatEther, parseEther, type Address, type Hex } from "viem";
import { storage, waitMined } from "../lib/chain.js";
import { loadConfig } from "../lib/config.js";
import { estimateGas, sendToAltMempool, sendToCanonical, toWire, txHash, type FrameTx } from "../lib/frameTx.js";
import { buildKeyTx, buildZkTx, type Action } from "../lib/anonTx.js";
import { oneTimeKey } from "../lib/keys.js";
import { KeystoreClient } from "../lib/keystoreClient.js";
import { policyByName } from "../lib/policies.js";
import { keyedNonceSlot } from "../lib/predeploys.js";
import { actionMessage, proveMembership } from "../lib/semaphore.js";
import { readState, requireDeployment, writeState } from "../lib/state.js";
import { transferCalldata, wethBalance } from "../lib/weth.js";

const log = (s: string) => console.error(s);

export class ActError extends Error {
  constructor(public readonly code: "NOT_A_MEMBER" | "EPOCH_USED" | "NO_KEYS" | "UNKNOWN_AGENT", message: string) {
    super(message);
  }
}

/** Has this (sender, nonce key) already been consumed on chain? The NONCE_MANAGER predeploy keeps the next seq. */
export async function nonceKeyUsed(sender: Address, key: bigint): Promise<boolean> {
  const v = await storage(loadConfig().nonceManager, keyedNonceSlot(sender, key));
  return !!v && BigInt(v) !== 0n;
}

export async function buildActionTx(agentName: string, action: Action): Promise<{ tx: FrameTx; note: Record<string, unknown>; commit: () => void }> {
  const cfg = loadConfig();
  const rec = readState().agents[agentName];
  if (!rec) throw new ActError("UNKNOWN_AGENT", `unknown agent ${agentName}`);
  const account = requireDeployment("account");
  const paymaster = requireDeployment("paymaster");
  const { policy, policyClass } = policyByName(rec.policyName);
  const ks = new KeystoreClient(requireDeployment("keystore"));

  if (rec.mode === "zk") {
    const ref = await ks.currentReference(policyClass);
    const members = await ks.members(policyClass);
    if (!members.includes(BigInt(rec.commitment!))) {
      throw new ActError("NOT_A_MEMBER", `agent ${agentName} is not a member of class ${rec.policyName} any more (revoked): no proof can be built`);
    }
    const message = actionMessage({ chainId: BigInt(cfg.chainId), account, policyClass, target: action.target, value: action.value, data: action.data });
    log(`zk: ${members.filter((m) => m !== 0n).length} members in class, root epoch ${ref.seq} (gen ${ref.generation}), proving…`);
    const t0 = Date.now();
    const proof = await proveMembership({ secret: rec.secret, members, message, scope: ref.seq });
    log(`proof in ${Date.now() - t0} ms; nullifier ${proof.nullifier.toString(16).slice(0, 12)}…`);
    if (await nonceKeyUsed(account, proof.nullifier)) {
      throw new ActError("EPOCH_USED", `agent ${agentName} already acted in epoch ${ref.seq}: its nullifier (nonce key) is consumed; wait for the next heartbeat`);
    }
    const tx = buildZkTx({ account, paymaster, policy, proof, action, recentRoot: ref.recentRoot });
    return { tx, note: { mode: "zk", epoch: ref.seq.toString(), nullifier: `0x${proof.nullifier.toString(16)}`, root: ref.recentRoot.root, slot: ref.recentRoot.slot.toString() }, commit: () => {} };
  }

  const used = rec.used ?? 0;
  if (used >= (rec.keys ?? 0)) throw new ActError("NO_KEYS", `agent ${agentName} has no unused one-time keys left`);
  const k = oneTimeKey(rec.secret, used);
  if (!(await ks.isMember(policyClass, BigInt(k.address)))) {
    throw new ActError("NOT_A_MEMBER", `agent ${agentName}'s one-time key #${k.index} is not a member of class ${rec.policyName} (revoked)`);
  }
  if (await nonceKeyUsed(account, BigInt(k.address))) {
    throw new ActError("EPOCH_USED", `one-time key #${k.index} was already used; the key counter is out of sync`);
  }
  log(`key: one-time key #${k.index} ${k.address}`);
  const tx = await buildKeyTx({ account, paymaster, policy, oneTimeKey: k.privateKey, oneTimeAddress: k.address, action });
  return { tx, note: { mode: "key", oneTimeKey: k.index, signer: k.address }, commit: () => writeState((s) => void (s.agents[agentName].used = used + 1)) };
}

/** Sends a built transaction to the alt-mempool and waits for it; returns the demo-friendly summary. */
export async function submitAndWait(tx: FrameTx, note: Record<string, unknown>, to?: Address) {
  const cfg = loadConfig();
  const account = requireDeployment("account");
  const before = to ? await wethBalance(to) : undefined;
  const h = await sendToAltMempool(tx);
  writeState((s) => (s.lastTx = h as Hex));
  log(`admitted by the standard alt-mempool: ${h}; waiting for inclusion…`);
  const r = await waitMined(h);
  const frames = (r.frameReceipts ?? []).map((f: any) => f.status).join(",");
  return {
    ok: r.status === "0x1", hash: h, block: parseInt(r.blockNumber), gasUsed: parseInt(r.gasUsed), frames,
    ...(to ? { recipientWethBefore: formatEther(before!), recipientWethAfter: formatEther(await wethBalance(to)) } : {}),
    accountWeth: formatEther(await wethBalance(account)), explorer: `${cfg.explorerUrl}tx/${h}`, ...note,
  };
}

const serialize = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `0x${x.toString(16)}` : x), 2);
const revive = (s: string): FrameTx =>
  JSON.parse(s, (k, v) => (typeof v === "string" && /^0x[0-9a-f]*$/i.test(v) && ["chainId", "nonceSeq", "value", "execution", "state", "maxFeePerGas", "maxPriorityFeePerGas", "maxFeePerBlobGas", "slot"].includes(k) ? BigInt(v) : k === "nonceKeys" ? (v as string[]).map(BigInt) : v));

async function main() {
  const args = process.argv.slice(2);
  const cfg = loadConfig();

  if (args[0] === "--send-prepared") {
    const { tx, note } = JSON.parse(fs.readFileSync(args[1], "utf8"));
    const revived = revive(JSON.stringify(tx));
    log(`sending prepared tx ${txHash(revived)} ${JSON.stringify(note)}`);
    console.log(JSON.stringify(await submitAndWait(revived, note)));
    return;
  }

  const [agentName, to, amount] = args;
  if (!agentName || !to || !amount) throw new Error("usage: act <agent> <to> <weth-amount> [--canonical] [--estimate] [--prepare <file>] | act --send-prepared <file>");
  const action: Action = { target: cfg.weth, value: 0n, data: transferCalldata(to as Address, parseEther(amount)) };

  const { tx, note, commit } = await buildActionTx(agentName, action);
  log(`tx ${txHash(tx)} ${JSON.stringify(note)}`);

  const prep = args.indexOf("--prepare");
  if (prep >= 0) {
    const file = args[prep + 1];
    fs.writeFileSync(file, serialize({ tx, note, wire: toWire(tx) }) + "\n");
    commit();
    console.log(JSON.stringify({ prepared: file, hash: txHash(tx), ...note }));
    return;
  }
  if (args.includes("--estimate")) {
    console.log(JSON.stringify(await estimateGas(tx), null, 1));
    return;
  }
  if (args.includes("--canonical")) {
    try {
      console.log(JSON.stringify({ ok: true, accepted: await sendToCanonical(tx) }));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, canonicalRejection: (e as Error).message }));
    }
    return;
  }
  commit();
  console.log(JSON.stringify(await submitAndWait(tx, note, to as Address)));
}

const isMain = process.argv[1]?.endsWith("act.ts");
if (isMain) main().then(() => process.exit(0), (e) => { console.error(e instanceof ActError ? `${e.code}: ${e.message}` : e); process.exit(1); });
