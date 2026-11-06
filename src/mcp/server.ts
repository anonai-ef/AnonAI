// AnonAI MCP server: the tools a Claude agent uses to read the chain and act anonymously.
//   tsx src/mcp/server.ts --agent <name>
// stdout is the MCP channel, so every log goes to stderr (console.log is redirected below: snarkjs prints warnings).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { formatEther, parseEther, type Address, type Hex } from "viem";
import { z } from "zod";
import { buildActionTx } from "../cli/act.js";
import { balance, waitMined } from "../lib/chain.js";
import { loadConfig } from "../lib/config.js";
import { artifact } from "../lib/contracts.js";
import { explorerRecord, mempoolStatus, sendToAltMempool, sendToCanonical, txHash } from "../lib/frameTx.js";
import { KeystoreClient } from "../lib/keystoreClient.js";
import { policyByName } from "../lib/policies.js";
import { publicClient } from "../lib/chain.js";
import { readState, requireDeployment, writeState } from "../lib/state.js";
import { rpc } from "../lib/rpc.js";
import { transferCalldata, wethBalance } from "../lib/weth.js";

console.log = (...a: unknown[]) => console.error(...a);

const agentName = process.argv[process.argv.indexOf("--agent") + 1];
if (!agentName || agentName.startsWith("--")) {
  console.error("usage: tsx src/mcp/server.ts --agent <name>");
  process.exit(2);
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });

const server = new McpServer({ name: "anonai", version: "0.1.0" });
// The SDK's zod-typed `tool` overloads make this TypeScript version hit TS2589 (excessively deep instantiation),
// so tools are registered through a loosely typed alias.
const tool = (server as any).tool.bind(server) as (name: string, description: string, shape: Record<string, unknown>, cb: (args: any) => Promise<unknown>) => void;

tool(
  "anonai_whoami",
  "Who this agent is: its authorisation mode, policy (what it may call and how much), the shared account it acts from, the paymaster that pays, the remaining budget and the treasury balance.",
  {},
  async () => {
    const cfg = loadConfig();
    const rec = readState().agents[agentName];
    if (!rec) return text({ error: `agent ${agentName} is not registered` });
    const { policy, policyClass } = policyByName(rec.policyName);
    const account = requireDeployment("account");
    const paymaster = requireDeployment("paymaster");
    const ks = new KeystoreClient(requireDeployment("keystore"));
    const budget = (await publicClient().readContract({ address: paymaster, abi: artifact("BudgetPaymaster").abi, functionName: "budget", args: [policyClass] })) as bigint;
    return text({
      agent: rec.name, mode: rec.mode, policyClass: rec.policyName,
      policy: { target: policy.target, asset: "WETH", selector: policy.selector, maxAmountPerAction: `${formatEther(policy.maxAmount)} WETH`, maxEthValue: formatEther(policy.maxValue) },
      sharedAccount: account, paymaster, keystore: ks.address,
      classEpoch: (await ks.rootSeq(policyClass)).toString(), classGeneration: await ks.generation(policyClass),
      remainingGasBudget: `${formatEther(budget)} ETH`, treasuryWeth: `${formatEther(await wethBalance(account))} WETH`,
      ...(rec.mode === "key" ? { oneTimeKeysLeft: (rec.keys ?? 0) - (rec.used ?? 0) } : {}),
      note: "You hold no ETH and no chain key. Each action is one frame transaction from the shared account, authorised by " + (rec.mode === "zk" ? "a zero-knowledge membership proof" : "a fresh one-time key") + " and paid by the paymaster.",
      explorer: cfg.explorerUrl,
    });
  },
);

tool(
  "anonai_read",
  "Read chain state through ethrex: WETH balance of an address, ETH balance, latest block, or a transaction receipt.",
  // cast: the SDK's zod overloads hit TS2589 (excessively deep instantiation) on an enum + optionals shape
  { what: z.enum(["wethBalance", "ethBalance", "blockNumber", "receipt"]), address: z.string().optional(), txHash: z.string().optional() },
  async ({ what, address, txHash: h }) => {
    const cfg = loadConfig();
    if (what === "wethBalance") return text({ address, weth: formatEther(await wethBalance(address as Address)) });
    if (what === "ethBalance") return text({ address, eth: formatEther(await balance(address as Address)) });
    if (what === "blockNumber") return text({ block: parseInt(await rpc<Hex>(cfg.ethrexUrl, "eth_blockNumber")) });
    return text((await rpc(cfg.ethrexUrl, "eth_getTransactionReceipt", [h])) ?? { pending: true });
  },
);

tool(
  "anonai_act",
  "Pay `amountWeth` WETH from the shared account to `to`. Builds the authorisation (zk proof or one-time key), assembles the frame transaction with the paymaster, submits it to the standard alt-mempool and waits for inclusion. Returns the hash, block, and what the chain saw.",
  { to: z.string(), amountWeth: z.string() },
  async ({ to, amountWeth }) => {
    const cfg = loadConfig();
    try {
      const action = { target: cfg.weth, value: 0n, data: transferCalldata(to as Address, parseEther(amountWeth)) };
      const { tx, note, commit } = await buildActionTx(agentName, action);
      const h = await sendToAltMempool(tx);
      commit();
      writeState((s) => (s.lastTx = h));
      const r = await waitMined(h);
      return text({
        ok: r.status === "0x1", txHash: h, block: parseInt(r.blockNumber), gasUsed: parseInt(r.gasUsed),
        frames: (r.frameReceipts ?? []).map((f: any) => f.status),
        sender: requireDeployment("account"), payer: requireDeployment("paymaster"), signatureScheme: note.mode === "zk" ? "0 (ARBITRARY: no key, a proof)" : "1 (one-time secp256k1 key)",
        ...note, explorer: `${cfg.explorerUrl}tx/${h}`,
      });
    } catch (e) {
      return text({ ok: false, error: (e as Error).message, hint: "Call anonai_status with the hash if one was issued; a nonce/nullifier error means this epoch is used up for you, a root/generation error means your key may have been revoked." });
    }
  },
);

tool(
  "anonai_act_canonical",
  "Build the identical transaction and send it to ethrex's canonical mempool instead of the alt-mempool, to show the canonical rules reject it. Returns the rejection text.",
  { to: z.string(), amountWeth: z.string() },
  async ({ to, amountWeth }) => {
    const cfg = loadConfig();
    const action = { target: cfg.weth, value: 0n, data: transferCalldata(to as Address, parseEther(amountWeth)) };
    const { tx, note } = await buildActionTx(agentName, action);
    try {
      return text({ unexpected: true, accepted: await sendToCanonical(tx), ...note });
    } catch (e) {
      return text({ rejectedByCanonicalMempool: true, txHash: txHash(tx), reason: (e as Error).message, ...note });
    }
  },
);

tool(
  "anonai_status",
  "Status of a transaction in the alt-mempool (New, Pending, Submitted, OnChain, Finalized, Cancelled, Reverted) plus the sidecar's rule-by-rule admission report and the receipt.",
  { txHash: z.string() },
  async ({ txHash: h }) => {
    const cfg = loadConfig();
    const out: Record<string, unknown> = { txHash: h };
    try { out.mempool = await mempoolStatus(h as Hex); } catch (e) { out.mempool = (e as Error).message; }
    try {
      const t: any = await explorerRecord(h as Hex);
      const a = t?.admission ?? t;
      out.admission = a ? { outcome: a.outcome, failed: (a.checks ?? []).filter((c: any) => c.verdict !== "pass"), passed: (a.checks ?? []).filter((c: any) => c.verdict === "pass").length, events: (t.events ?? []).map((e: any) => `${e.kind} ${e.status ?? ""} ${e.reason ?? ""}`.trim()) } : "no record";
    } catch (e) { out.admission = (e as Error).message; }
    out.receipt = (await rpc(cfg.ethrexUrl, "eth_getTransactionReceipt", [h])) ?? "not mined";
    out.explorer = `${cfg.explorerUrl}tx/${h}`;
    return text(out);
  },
);

await server.connect(new StdioServerTransport());
console.error(`AnonAI MCP server up for agent ${agentName}`);
