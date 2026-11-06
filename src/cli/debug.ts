// yarn debug <txHash>
// The habit from the workshop's step 11: never guess at a rejection. Prints the sidecar's rule-by-rule admission
// report and lifecycle events (gateway and miner), the mempool status, and ethrex's receipt.
import { loadConfig } from "../lib/config.js";
import { rpc } from "../lib/rpc.js";
import { readState } from "../lib/state.js";

const hash = (process.argv[2] ?? readState().lastTx) as `0x${string}` | undefined;

/** Decodes an Error(string) revert payload embedded in a sidecar message, e.g. "reverted with data 0x08c379a0…". */
function decodeReverts(s: string): string {
  return s.replace(/0x08c379a0[0-9a-f]+/gi, (hex) => {
    try {
      const body = hex.slice(10);
      const len = parseInt(body.slice(64, 128), 16);
      const text = Buffer.from(body.slice(128, 128 + len * 2), "hex").toString("utf8");
      return `Error("${text}")`;
    } catch {
      return hex;
    }
  });
}
if (!hash) {
  console.error("usage: yarn debug <txHash>");
  process.exit(2);
}

async function explorer(name: string, url: string) {
  console.log(`== ${name}`);
  try {
    const t: any = await rpc(url, "skandha_explorer_getTransaction", [hash]);
    if (!t) {
      console.log("  no record on this node");
      return;
    }
    const admissions: any[] = t.admissions ?? (t.admission ? [t.admission] : Array.isArray(t.checks) ? [t] : []);
    for (const a of admissions) {
      console.log(`  admission: ${a.outcome ?? "?"}${a.errorCode ? ` (error ${a.errorCode})` : ""}${a.errorMessage ? ` ${a.errorMessage}` : ""}`);
      const checks: any[] = a.checks ?? [];
      const failed = checks.filter((c) => c.verdict !== "pass");
      for (const c of failed) console.log(`    ${String(c.verdict).toUpperCase()} ${c.rule}${c.entity ? ` [${c.entity}]` : ""}${c.frameIndex !== undefined ? ` frame ${c.frameIndex}` : ""}: ${decodeReverts(c.detail ?? "")}`);
      console.log(`    (${checks.length - failed.length} checks passed, ${failed.length} not)`);
      if (a.frameStatuses) console.log(`    frame statuses: ${JSON.stringify(a.frameStatuses)}`);
    }
    const events: any[] = t.lifecycle ?? t.events ?? [];
    if (events.length) {
      console.log("  lifecycle:");
      for (const e of events) console.log(`    ${e.kind}${e.status ? ` ${e.status}` : ""}${e.reason ? `: ${decodeReverts(e.reason)}` : ""}${e.blockNumber ? ` (block ${e.blockNumber})` : ""}`);
    }
  } catch (e) {
    console.log(`  ${(e as Error).message}`);
  }
  try {
    const s = await rpc(url, "skandha_frameTransactionStatus", [hash]);
    console.log(`  status: ${JSON.stringify(s)}`);
  } catch (e) {
    console.log(`  status: ${(e as Error).message}`);
  }
}

async function main() {
  const cfg = loadConfig();
  console.log(`tx ${hash}`);
  await explorer("gateway", cfg.gatewayUrl);
  await explorer("miner", `${cfg.ethrexUrl}/rpc`);
  console.log("== ethrex receipt");
  const r: any = await rpc(cfg.ethrexUrl, "eth_getTransactionReceipt", [hash]);
  if (!r) console.log("  none (not mined)");
  else {
    console.log(`  status ${r.status} block ${parseInt(r.blockNumber)} gasUsed ${parseInt(r.gasUsed)}`);
    if (r.frameReceipts) console.log(`  frames: ${r.frameReceipts.map((f: any, i: number) => `${i}:${f.status}`).join(" ")}`);
  }
  console.log(`explorer: ${cfg.explorerUrl}tx/${hash}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
