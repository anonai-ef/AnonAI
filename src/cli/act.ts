// yarn act <agent> <to> <weth-amount> [--canonical] [--estimate]
// Sends one agent action: a WETH transfer from the shared account, authorised in the agent's mode (zk or key),
// paid by the paymaster. --canonical sends the identical bytes to ethrex's own mempool instead (expected: rejected).
import { formatEther, parseEther, type Address, type Hex } from "viem";
import { waitMined } from "../lib/chain.js";
import { loadConfig } from "../lib/config.js";
import { estimateGas, sendToAltMempool, sendToCanonical, txHash, type FrameTx } from "../lib/frameTx.js";
import { buildKeyTx, buildZkTx, type Action } from "../lib/anonTx.js";
import { oneTimeKey } from "../lib/keys.js";
import { KeystoreClient } from "../lib/keystoreClient.js";
import { policyByName } from "../lib/policies.js";
import { actionMessage, proveMembership } from "../lib/semaphore.js";
import { readState, requireDeployment, writeState } from "../lib/state.js";
import { transferCalldata, wethBalance } from "../lib/weth.js";

const log = (s: string) => console.error(s);

export async function buildActionTx(agentName: string, action: Action): Promise<{ tx: FrameTx; note: Record<string, unknown>; commit: () => void }> {
  const cfg = loadConfig();
  const rec = readState().agents[agentName];
  if (!rec) throw new Error(`unknown agent ${agentName}`);
  const account = requireDeployment("account");
  const paymaster = requireDeployment("paymaster");
  const { policy, policyClass } = policyByName(rec.policyName);
  const ks = new KeystoreClient(requireDeployment("keystore"));

  if (rec.mode === "zk") {
    const ref = await ks.currentReference(policyClass);
    const members = await ks.members(policyClass);
    const message = actionMessage({ chainId: BigInt(cfg.chainId), account, policyClass, target: action.target, value: action.value, data: action.data });
    log(`zk: ${members.filter((m) => m !== 0n).length} members in class, root epoch ${ref.seq} (gen ${ref.generation}), proving…`);
    const t0 = Date.now();
    const proof = await proveMembership({ secret: rec.secret, members, message, scope: ref.seq });
    log(`proof in ${Date.now() - t0} ms; nullifier ${proof.nullifier.toString(16).slice(0, 12)}…`);
    const tx = buildZkTx({ account, paymaster, policy, proof, action, recentRoot: ref.recentRoot });
    return { tx, note: { mode: "zk", epoch: ref.seq.toString(), nullifier: `0x${proof.nullifier.toString(16)}`, root: ref.recentRoot.root, slot: ref.recentRoot.slot.toString() }, commit: () => {} };
  }

  const used = rec.used ?? 0;
  if (used >= (rec.keys ?? 0)) throw new Error(`agent ${agentName} has no unused one-time keys left`);
  const k = oneTimeKey(rec.secret, used);
  log(`key: one-time key #${k.index} ${k.address}`);
  const tx = await buildKeyTx({ account, paymaster, policy, oneTimeKey: k.privateKey, oneTimeAddress: k.address, action });
  return { tx, note: { mode: "key", oneTimeKey: k.index, signer: k.address }, commit: () => writeState((s) => void (s.agents[agentName].used = used + 1)) };
}

async function main() {
  const [agentName, to, amount] = process.argv.slice(2);
  if (!agentName || !to || !amount) throw new Error("usage: act <agent> <to> <weth-amount> [--canonical] [--estimate]");
  const cfg = loadConfig();
  const account = requireDeployment("account");
  const action: Action = { target: cfg.weth, value: 0n, data: transferCalldata(to as Address, parseEther(amount)) };

  const { tx, note, commit } = await buildActionTx(agentName, action);
  const hash = txHash(tx);
  log(`tx ${hash} ${JSON.stringify(note)}`);

  if (process.argv.includes("--estimate")) {
    console.log(JSON.stringify(await estimateGas(tx), null, 1));
    return;
  }
  if (process.argv.includes("--canonical")) {
    try {
      const h = await sendToCanonical(tx);
      console.log(JSON.stringify({ ok: true, accepted: h }));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, canonicalRejection: (e as Error).message }));
    }
    return;
  }

  const before = await wethBalance(to as Address);
  const h = await sendToAltMempool(tx);
  commit();
  writeState((s) => (s.lastTx = h as Hex));
  log(`admitted by the standard alt-mempool: ${h}; waiting for inclusion…`);
  const r = await waitMined(h);
  const frames = (r.frameReceipts ?? []).map((f: any) => f.status).join(",");
  const after = await wethBalance(to as Address);
  console.log(JSON.stringify({ ok: r.status === "0x1", hash: h, block: parseInt(r.blockNumber), gasUsed: parseInt(r.gasUsed), frames, recipientWethBefore: formatEther(before), recipientWethAfter: formatEther(after), accountWeth: formatEther(await wethBalance(account)), explorer: `${cfg.explorerUrl}tx/${h}`, ...note }));
}

const isMain = process.argv[1]?.endsWith("act.ts");
if (isMain) main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
