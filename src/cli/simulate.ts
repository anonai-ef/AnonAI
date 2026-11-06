// yarn simulate <agent> <to> <weth-amount>
// Dry-runs the agent's action through ethrex_simulateFrameTransaction with the ERC-7562 trace: per-frame success,
// gas, the prefix shape and payer ethrex derives, and the storage/transient slots each frame touched.
import { parseEther, type Address } from "viem";
import { buildActionTx } from "./act.js";
import { loadConfig } from "../lib/config.js";
import { encodeRaw, txHash } from "../lib/frameTx.js";
import { rpc } from "../lib/rpc.js";
import { transferCalldata } from "../lib/weth.js";

async function main() {
  const [agentName, to, amount] = process.argv.slice(2);
  if (!agentName || !to || !amount) throw new Error("usage: simulate <agent> <to> <weth-amount>");
  const cfg = loadConfig();
  const action = { target: cfg.weth, value: 0n, data: transferCalldata(to as Address, parseEther(amount)) };
  const { tx, note } = await buildActionTx(agentName, action);
  console.error(`tx ${txHash(tx)} ${JSON.stringify(note)}`);
  const r: any = await rpc(cfg.ethrexUrl, "ethrex_simulateFrameTransaction", [encodeRaw(tx), "latest", { trace: true }]);
  const { erc7562Trace, ...rest } = r;
  console.log(JSON.stringify(rest, null, 1));
  if (erc7562Trace) {
    for (const [i, f] of (erc7562Trace as any[]).entries()) {
      const keys = Object.keys(f);
      console.log(`frame ${i}: keys ${keys.join(",")}`);
      for (const k of keys) {
        const v = f[k];
        const s = JSON.stringify(v);
        if (/storage|transient|slot|out|revert|error|status|gas/i.test(k)) console.log(`  ${k}: ${s.length > 900 ? s.slice(0, 900) + "…" : s}`);
      }
    }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
