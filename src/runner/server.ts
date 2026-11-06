// yarn runner  (http://localhost:8787)
// The local runner the dashboard drives during a demo: it holds the operator key and agent secrets (devnet only),
// runs the prover, builds and submits frame transactions, and streams every step as server-sent events so the
// page can animate the pipeline. The hosted dashboard works read-only without it.
import http from "node:http";
import { parseEther, type Address, type Hex } from "viem";
import { ActError, buildActionTx, submitAndWait, type ActEvent } from "../cli/act.js";
import { loadConfig } from "../lib/config.js";
import { publicFacts } from "../lib/facts.js";
import { sendToCanonical, txHash, type FrameTx } from "../lib/frameTx.js";
import { budgetOf, fundBudget, heartbeat, registerAgent, revokeAgent, topUpTreasury } from "../lib/owner.js";
import { readState } from "../lib/state.js";
import { transferCalldata } from "../lib/weth.js";

const PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || 8787;

type Event = { id: number; ts: number; type: string; data: Record<string, unknown> };
const events: Event[] = [];
const clients = new Set<http.ServerResponse>();
let nextId = 1;
function emit(type: string, data: Record<string, unknown> = {}) {
  const e: Event = { id: nextId++, ts: Date.now(), type, data };
  events.push(e);
  if (events.length > 500) events.shift();
  const line = `id: ${e.id}\nevent: ${type}\ndata: ${JSON.stringify(e)}\n\n`;
  for (const c of clients) c.write(line);
  console.error(`[${new Date(e.ts).toLocaleTimeString()}] ${type} ${JSON.stringify(data).slice(0, 160)}`);
}

const prepared = new Map<string, { tx: FrameTx; note: Record<string, unknown>; agent: string }>();
let busy = false;

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
};
const readBody = (req: http.IncomingMessage) =>
  new Promise<any>((resolve, reject) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
  });

/** Decodes an Error(string) payload inside a node message so the page shows "AnonAI: budget exhausted", not hex. */
function decodeReverts(s: string): string {
  return s.replace(/0x08c379a0[0-9a-f]+/gi, (hex) => {
    try {
      const body = hex.slice(10);
      const len = parseInt(body.slice(64, 128), 16);
      return `Error("${Buffer.from(body.slice(128, 128 + len * 2), "hex").toString("utf8")}")`;
    } catch {
      return hex;
    }
  });
}

/** A transaction's maximum cost is charged to the class budget up front; keep at least a few actions' worth. */
const MIN_BUDGET_WEI = parseEther("0.006");
const TOP_UP_ETH = "0.03";

async function act(body: { agent: string; to: string; amountWeth: string; canonical?: boolean; autoHeartbeat?: boolean; prepareOnly?: boolean }) {
  const cfg = loadConfig();
  const runId = `${Date.now().toString(36)}`;
  const base = { runId, agent: body.agent, to: body.to, amountWeth: body.amountWeth };
  const action = { target: cfg.weth, value: 0n, data: transferCalldata(body.to as Address, parseEther(body.amountWeth)) };
  const onEvent = (e: ActEvent) => emit(`act.${e.type}`, { ...base, ...e });
  const rec = readState().agents[body.agent];
  emit("act.start", { ...base, mode: rec?.mode, canonical: !!body.canonical });
  try {
    // keep the class budget topped up, otherwise pre_verify reverts with "budget exhausted"
    if (rec && !body.canonical) {
      const budget = await budgetOf(rec.policyName);
      if (budget < MIN_BUDGET_WEI) {
        emit("fund.start", { ...base, policy: rec.policyName, budget: budget.toString(), eth: TOP_UP_ETH });
        const h = await fundBudget(rec.policyName, TOP_UP_ETH);
        emit("fund.done", { ...base, policy: rec.policyName, eth: TOP_UP_ETH, txHash: h, budget: (await budgetOf(rec.policyName)).toString() });
      }
    }
    let built;
    try {
      built = await buildActionTx(body.agent, action, onEvent);
    } catch (e) {
      if (e instanceof ActError && e.code === "EPOCH_USED" && body.autoHeartbeat) {
        const rec = readState().agents[body.agent];
        emit("act.epochUsed", { ...base, message: e.message });
        emit("heartbeat.start", { ...base, policy: rec.policyName });
        const hb = await heartbeat(rec.policyName, (s) => emit("heartbeat.log", { ...base, message: s }));
        emit("heartbeat.done", { ...base, ...hb });
        built = await buildActionTx(body.agent, action, onEvent);
      } else throw e;
    }
    const { tx, note, commit } = built;
    if (body.prepareOnly) {
      const id = txHash(tx);
      prepared.set(id, { tx, note, agent: body.agent });
      commit();
      emit("act.prepared", { ...base, hash: id, ...note });
      return { prepared: id, ...note };
    }
    if (body.canonical) {
      try {
        const h = await sendToCanonical(tx);
        emit("act.canonicalAccepted", { ...base, hash: h });
        return { unexpected: true, hash: h };
      } catch (e) {
        emit("act.canonicalRejected", { ...base, hash: txHash(tx), reason: (e as Error).message, ...note });
        return { canonicalRejected: true, reason: (e as Error).message, ...note };
      }
    }
    commit();
    const result = await submitAndWait(tx, note, body.to as Address, (h) => emit("act.submitted", { ...base, hash: h, ...note }));
    emit(result.ok ? "act.included" : "act.reverted", { ...base, ...result });
    return result;
  } catch (e) {
    const err = e as Error;
    emit("act.rejected", { ...base, code: e instanceof ActError ? e.code : "RPC", message: decodeReverts(err.message) });
    throw err;
  }
}

async function sendPrepared(id: string) {
  const p = prepared.get(id);
  if (!p) throw new Error("no such prepared transaction");
  const base = { runId: Date.now().toString(36), agent: p.agent, prepared: true };
  emit("act.start", { ...base, mode: readState().agents[p.agent]?.mode, hash: id });
  try {
    const r = await submitAndWait(p.tx, p.note, undefined, (h) => emit("act.submitted", { ...base, hash: h, ...p.note }));
    emit(r.ok ? "act.included" : "act.reverted", { ...base, ...r });
    return r;
  } catch (e) {
    emit("act.rejected", { ...base, code: "RPC", message: decodeReverts((e as Error).message), hash: id });
    throw e;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
    return res.end();
  }
  try {
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, busy, agents: Object.keys(readState().agents), events: events.length });
    if (req.method === "GET" && url.pathname === "/facts") return json(res, 200, publicFacts());
    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
      res.write(": connected\n\n");
      const since = Number(url.searchParams.get("since") ?? 0);
      for (const e of events.filter((e) => e.id > since)) res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method !== "POST") return json(res, 404, { error: "not found" });
    const body = await readBody(req);
    if (busy && url.pathname !== "/prepare") return json(res, 409, { error: "runner is busy with another operation" });
    busy = true;
    try {
      if (url.pathname === "/agents") {
        emit("agent.registering", body);
        const r = await registerAgent(body, (s) => emit("agent.log", { message: s }));
        emit("agent.registered", { name: r.name, mode: r.mode, policyName: r.policyName, txHash: r.txHash, epoch: r.epoch });
        return json(res, 200, { name: r.name, mode: r.mode, policyName: r.policyName, txHash: r.txHash, epoch: r.epoch });
      }
      if (url.pathname === "/act") return json(res, 200, await act(body));
      if (url.pathname === "/prepare") return json(res, 200, await act({ ...body, prepareOnly: true }));
      if (url.pathname === "/send-prepared") return json(res, 200, await sendPrepared(body.id));
      if (url.pathname === "/heartbeat") {
        emit("heartbeat.start", { policy: body.policy });
        const r = await heartbeat(body.policy, (s) => emit("heartbeat.log", { message: s }));
        emit("heartbeat.done", { policy: body.policy, ...r });
        return json(res, 200, r);
      }
      if (url.pathname === "/revoke") {
        emit("revoke.start", { agent: body.agent });
        const r = await revokeAgent(body.agent, (s) => emit("revoke.log", { message: s }));
        emit("revoke.done", { agent: body.agent, ...r });
        return json(res, 200, r);
      }
      if (url.pathname === "/fund") {
        const h = await fundBudget(body.policy, body.eth);
        const budget = (await budgetOf(body.policy)).toString();
        emit("fund.done", { policy: body.policy, eth: body.eth, txHash: h, budget });
        return json(res, 200, { txHash: h, budget });
      }
      if (url.pathname === "/treasury") {
        const r = await topUpTreasury(body.eth);
        emit("treasury.done", { eth: body.eth, ...r });
        return json(res, 200, r);
      }
      return json(res, 404, { error: "not found" });
    } finally {
      busy = false;
    }
  } catch (e) {
    return json(res, 500, { error: (e as Error).message, code: e instanceof ActError ? e.code : undefined });
  }
});

server.listen(PORT, () => console.error(`AnonAI runner listening on http://localhost:${PORT} (agents: ${Object.keys(readState().agents).join(", ") || "none"})`));
