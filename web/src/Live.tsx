// The live view: a first-run wizard, then an autopilot that keeps acting while the pipeline, the observer panel
// and the anonymity set animate from the runner's event stream.
import { useEffect, useMemo, useRef, useState } from "react";
import { short, type Facts, type Overview } from "./lib/data";
import { runnerHealth, runnerPost, runnerUrl, setRunnerUrl, subscribe, type RunnerEvent } from "./lib/runner";

export interface LiveConfig {
  agent: string;
  mode: "zk" | "key";
  policyName: string;
  to: string;
  amountWeth: string;
  cadenceSec: number;
}
const CFG_KEY = "anonai.live";
const loadCfg = (): LiveConfig | null => {
  try {
    const s = localStorage.getItem(CFG_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const saveCfg = (c: LiveConfig | null) => {
  try {
    c ? localStorage.setItem(CFG_KEY, JSON.stringify(c)) : localStorage.removeItem(CFG_KEY);
  } catch {}
};

type StageId = "agent" | "prove" | "frames" | "gateway" | "miner" | "block";
interface Run {
  runId: string;
  mode: "zk" | "key";
  stage: StageId;
  failed?: { at: StageId; message: string };
  canonical?: boolean;
  members?: number;
  epoch?: string;
  generation?: number;
  proofMs?: number;
  nullifier?: string;
  keyIndex?: number;
  keyAddress?: string;
  hash?: string;
  block?: number;
  gasUsed?: number;
  waitingHeartbeat?: string;
}

const STAGES: { id: StageId; title: string; sub: string }[] = [
  { id: "agent", title: "Claude agent", sub: "decides to pay" },
  { id: "prove", title: "Authorise", sub: "ZK proof or one-time key" },
  { id: "frames", title: "Frame tx", sub: "4 frames, no ETH, no key" },
  { id: "gateway", title: "Gateway sidecar", sub: "ERC-8421 rules" },
  { id: "miner", title: "Miner", sub: "gossip → builder" },
  { id: "block", title: "Block", sub: "included" },
];
const order = (s: StageId) => STAGES.findIndex((x) => x.id === s);

function reduceRun(run: Run | null, e: RunnerEvent): Run | null {
  const d = e.data;
  if (e.type === "act.start") return { runId: d.runId, mode: d.mode ?? "zk", stage: "agent", canonical: !!d.canonical };
  if (!run || d.runId !== run.runId) return run;
  switch (e.type) {
    case "act.sync": return { ...run, members: d.members, epoch: d.epoch, generation: d.generation };
    case "act.proving": return { ...run, stage: "prove", mode: d.mode };
    case "act.proved": return { ...run, proofMs: d.ms, nullifier: d.nullifier };
    case "act.key": return { ...run, keyIndex: d.index, keyAddress: d.address };
    case "act.built": return { ...run, stage: "frames", hash: d.hash };
    case "act.submitted": return { ...run, stage: "gateway", hash: d.hash };
    case "act.included": return { ...run, stage: "block", hash: d.hash, block: d.block, gasUsed: d.gasUsed };
    case "act.canonicalRejected": return { ...run, stage: "gateway", failed: { at: "gateway", message: d.reason } };
    case "act.epochUsed": return { ...run, waitingHeartbeat: d.message };
    case "heartbeat.done": return { ...run, waitingHeartbeat: undefined, epoch: d.epoch };
    case "act.rejected": return { ...run, failed: { at: run.stage === "agent" ? "prove" : run.stage === "frames" ? "gateway" : run.stage, message: d.message } };
    case "act.reverted": return { ...run, stage: "block", failed: { at: "block", message: "a frame failed on chain" } };
    default: return run;
  }
}

export function LiveView({ f, o }: { f: Facts; o: Overview | null }) {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof runnerHealth>>>(undefined as any);
  const [cfg, setCfg] = useState<LiveConfig | null>(loadCfg());
  const [run, setRun] = useState<Run | null>(null);
  const [log, setLog] = useState<RunnerEvent[]>([]);
  const [history, setHistory] = useState<Run[]>([]);
  const runRef = useRef<Run | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => runnerHealth().then((h) => alive && setHealth(h));
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!health?.ok) return;
    const off = subscribe((e) => {
      setLog((l) => [...l.slice(-199), e]);
      const next = reduceRun(runRef.current, e);
      if (next !== runRef.current) {
        if (e.type === "act.start" && runRef.current) setHistory((h) => [runRef.current!, ...h].slice(0, 12));
        runRef.current = next;
        setRun(next);
      }
    });
    return off;
  }, [health?.ok]);

  if (health === undefined) return <main><p className="dim">looking for the local runner…</p></main>;
  if (!health?.ok) return <main><RunnerMissing /></main>;
  if (!cfg) return <main><Wizard f={f} o={o} agents={health.agents} onDone={(c) => { saveCfg(c); setCfg(c); }} /></main>;
  return (
    <main>
      <Autopilot f={f} o={o} cfg={cfg} run={run} history={history} log={log} onReset={() => { saveCfg(null); setCfg(null); }} />
    </main>
  );
}

function RunnerMissing() {
  const [url, setUrl] = useState(runnerUrl());
  return (
    <section className="card wide">
      <h2>Connect the runner to go live</h2>
      <p className="lede">The live view drives a small local process that holds the agent secrets, runs the prover and submits frame transactions. Everything else on this site is live from the devnet without it.</p>
      <pre className="mono block">cd /Users/adrija/AnonAI && yarn runner</pre>
      <div className="row">
        <input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button onClick={() => { setRunnerUrl(url); location.reload(); }}>use this runner URL</button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ wizard ------

function Wizard({ f, o, agents, onDone }: { f: Facts; o: Overview | null; agents: string[]; onDone: (c: LiveConfig) => void }) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"zk" | "key">("zk");
  const [policyName, setPolicyName] = useState(f.policies[0]?.name ?? "weth-0.01");
  const [agent, setAgent] = useState("");
  const [to, setTo] = useState<string>(f.demoRecipient);
  const [amount, setAmount] = useState("0.001");
  const [cadence, setCadence] = useState(45);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const existing = f.agents.filter((a) => a.mode === mode && a.policyName === policyName && agents.includes(a.name));
  const cls = o?.classes.find((c) => c.name === policyName);

  const launch = async () => {
    setError(null);
    try {
      let name = agent.trim();
      if (!name) throw new Error("name the agent");
      if (!agents.includes(name)) {
        setBusy(`registering ${name} in the Keystore (one transaction)…`);
        await runnerPost("/agents", { name, mode, policyName, keys: 8 });
      }
      if (cls && Number(cls.budget) < 0.005) {
        setBusy("funding the class gas budget…");
        await runnerPost("/fund", { policy: policyName, eth: "0.02" });
      }
      if (o && Number(o.account.weth) < Number(amount) * 3) {
        setBusy("wrapping ETH into the shared account's WETH treasury…");
        await runnerPost("/treasury", { eth: "0.05" });
      }
      setBusy(null);
      onDone({ agent: name, mode, policyName, to, amountWeth: amount, cadenceSec: cadence });
    } catch (e) {
      setBusy(null);
      setError((e as Error).message);
    }
  };

  return (
    <section className="wizard">
      <ol className="steps">
        {["Authorisation", "Policy & agent", "Action & cadence", "Launch"].map((t, i) => (
          <li key={t} className={i === step ? "on" : i < step ? "done" : ""} onClick={() => i < step && setStep(i)}>{t}</li>
        ))}
      </ol>

      {step === 0 && (
        <div>
          <h2>How should the agent prove it may act?</h2>
          <div className="choices">
            <button className={`choice ${mode === "zk" ? "on zk" : ""}`} onClick={() => setMode("zk")}>
              <span className="big">Zero-knowledge proof</span>
              <span>A Semaphore membership proof. The chain sees a proof and a nullifier: no key, no identity, no link to the owner or to other actions. Signature scheme 0.</span>
              <span className="dim">~300k validation gas · ~300 ms to prove</span>
            </button>
            <button className={`choice ${mode === "key" ? "on key" : ""}`} onClick={() => setMode("key")}>
              <span className="big">One-time key</span>
              <span>A fresh secp256k1 key per action, registered in the same Keystore. Cheap, but the key is visible, so the action can be joined to its registration.</span>
              <span className="dim">~54k validation gas · instant</span>
            </button>
          </div>
          <div className="row end"><button className="primary" onClick={() => setStep(1)}>Next</button></div>
        </div>
      )}

      {step === 1 && (
        <div>
          <h2>Which policy class, and what is the agent called?</h2>
          <p className="lede">The class is what the owner allows and the agent's anonymity set. Everyone in a class looks the same on chain.</p>
          <div className="choices">
            {f.policies.map((p) => (
              <button key={p.name} className={`choice ${policyName === p.name ? "on" : ""}`} onClick={() => setPolicyName(p.name)}>
                <span className="big">{p.name}</span>
                <span>WETH transfers up to {p.maxAmount} WETH per action</span>
                <span className="dim">{o?.classes.find((c) => c.name === p.name)?.members ?? "…"} members · epoch {o?.classes.find((c) => c.name === p.name)?.epoch ?? "…"}</span>
              </button>
            ))}
          </div>
          <label>Agent name <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="e.g. claude" list="agents" /></label>
          <datalist id="agents">{existing.map((a) => <option key={a.name} value={a.name} />)}</datalist>
          {existing.length > 0 && <p className="dim">existing {mode} agents in this class: {existing.map((a) => a.name).join(", ")} (pick one to reuse, or type a new name to register)</p>}
          <div className="row end"><button onClick={() => setStep(0)}>Back</button><button className="primary" onClick={() => agent.trim() && setStep(2)}>Next</button></div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2>What should it do, and how often?</h2>
          <label>Pay to <input className="mono" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label>Amount (WETH) <input value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label>Every <input type="number" min={35} value={cadence} onChange={(e) => setCadence(Number(e.target.value))} /> seconds <span className="dim">(one action per epoch; the runner opens a new epoch when needed, which takes ~30 s)</span></label>
          <div className="row end"><button onClick={() => setStep(1)}>Back</button><button className="primary" onClick={() => setStep(3)}>Next</button></div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2>Ready</h2>
          <dl>
            <dt>agent</dt><dd>{agent} <span className={`pill ${mode}`}>{mode}</span> in <strong>{policyName}</strong>{agents.includes(agent) ? " (already registered)" : " (will be registered now)"}</dd>
            <dt>action</dt><dd>pay {amount} WETH to <span className="mono">{short(to)}</span> every {cadence}s</dd>
            <dt>pays gas</dt><dd>the budget paymaster, from the {policyName} budget ({cls?.budget ?? "…"} ETH left)</dd>
            <dt>agent holds</dt><dd>no ETH, no chain key</dd>
          </dl>
          {error && <p className="bad">{error}</p>}
          <div className="row end"><button onClick={() => setStep(2)}>Back</button><button className="primary" disabled={!!busy} onClick={launch}>{busy ?? "Launch autopilot"}</button></div>
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------------------------- autopilot ------

function Autopilot({ f, o, cfg, run, history, log, onReset }: { f: Facts; o: Overview | null; cfg: LiveConfig; run: Run | null; history: Run[]; log: RunnerEvent[]; onReset: () => void }) {
  const [running, setRunning] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<string | null>(null);
  const busyRef = useRef(false);

  const fire = async (opts: { canonical?: boolean } = {}) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await runnerPost("/act", { agent: cfg.agent, to: cfg.to, amountWeth: cfg.amountWeth, autoHeartbeat: true, ...opts });
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setCountdown(cfg.cadenceSec);
    }
  };

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fire();
          return cfg.cadenceSec;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, cfg]);

  const revoke = async () => {
    setBusy(true);
    try {
      setNotice("preparing one more action before the revocation, so the stale proof can be shown refused…");
      const p = await runnerPost("/prepare", { agent: cfg.agent, to: cfg.to, amountWeth: cfg.amountWeth, autoHeartbeat: true });
      setPrepared(p.prepared);
      setNotice("revoking the agent in the Keystore…");
      await runnerPost("/revoke", { agent: cfg.agent });
      setNotice("revoked. The prepared transaction will now be sent: watch frame 0 refuse the old generation.");
      setRunning(false);
      await runnerPost("/send-prepared", { id: p.prepared }).catch(() => {});
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cls = o?.classes.find((c) => c.name === cfg.policyName);
  const included = history.filter((r) => r.stage === "block" && !r.failed).length + (run?.stage === "block" && !run.failed ? 1 : 0);

  return (
    <>
      <section className="hero">
        <div className="hero-head">
          <div>
            <h2>
              <span className={`pill ${cfg.mode}`}>{cfg.mode === "zk" ? "zero-knowledge" : "one-time key"}</span> agent <strong>{cfg.agent}</strong> on autopilot
            </h2>
            <p className="lede">Pays {cfg.amountWeth} WETH to <span className="mono">{short(cfg.to)}</span> every {cfg.cadenceSec}s from the shared account. It holds no ETH and no chain key.</p>
          </div>
          <div className="controls">
            <div className="counter"><span className="n">{included}</span><span>included this session</span></div>
            <div className="counter"><span className="n">{busy ? "…" : running ? `${countdown}s` : "paused"}</span><span>next action</span></div>
            <button onClick={() => setRunning((r) => !r)}>{running ? "Pause" : "Resume"}</button>
            <button disabled={busy} onClick={() => fire()}>Act now</button>
            <button disabled={busy} onClick={() => fire({ canonical: true })} title="send the identical bytes to ethrex's canonical mempool">Try canonical mempool</button>
            <button disabled={busy} className="danger" onClick={revoke}>Revoke this agent</button>
            <button onClick={onReset}>Reconfigure</button>
          </div>
        </div>
        {notice && <p className="notice">{notice}</p>}
        <Pipeline run={run} />
      </section>

      <section className="grid two">
        <Observer f={f} cfg={cfg} run={run} />
        <AnonymitySet members={cls?.members ?? run?.members ?? 0} mode={cfg.mode} run={run} />
      </section>

      <section className="grid two">
        <History f={f} history={run ? [run, ...history] : history} />
        <EventLog log={log} />
      </section>
    </>
  );
}

function Pipeline({ run }: { run: Run | null }) {
  const at = run ? order(run.failed?.at ?? run.stage) : -1;
  const done = run && run.stage === "block" && !run.failed;
  return (
    <div className={`pipeline ${run?.failed ? "failed" : ""} ${done ? "done" : ""}`}>
      <div className="track"><div className="fill" style={{ width: `${run ? (at / (STAGES.length - 1)) * 100 : 0}%` }} />{run && !done && !run.failed && <div className="packet" style={{ left: `${(at / (STAGES.length - 1)) * 100}%` }} />}</div>
      <div className="stages">
        {STAGES.map((s, i) => {
          const state = !run ? "idle" : run.failed && run.failed.at === s.id ? "fail" : i < at ? "past" : i === at ? (done ? "past" : "active") : "idle";
          return (
            <div key={s.id} className={`stage ${state}`}>
              <div className="dot" />
              <div className="title">{s.title}</div>
              <div className="sub">{stageDetail(s.id, run) ?? s.sub}</div>
            </div>
          );
        })}
      </div>
      {run?.failed && <p className="failmsg">{run.failed.at === "gateway" && run.canonical ? "Canonical mempool: " : "Refused: "}{run.failed.message}</p>}
      {run?.waitingHeartbeat && <p className="notice">epoch used up for this agent → the runner is opening a new epoch (heartbeat, ~30 s), then retries</p>}
    </div>
  );
}

function stageDetail(id: StageId, run: Run | null): string | undefined {
  if (!run) return undefined;
  switch (id) {
    case "agent": return run.epoch ? `epoch ${run.epoch} · ${run.members ?? "?"} in class` : undefined;
    case "prove": return run.mode === "zk" ? (run.proofMs !== undefined ? `Groth16 proof in ${run.proofMs} ms` : order(run.stage) >= 1 ? "proving…" : undefined) : run.keyAddress ? `one-time key #${run.keyIndex}` : undefined;
    case "frames": return run.hash ? `sender = shared account · sig scheme ${run.mode === "zk" ? "0" : "1"}` : undefined;
    case "gateway": return run.canonical ? "sent to ethrex instead" : order(run.stage) >= 3 ? (run.failed?.at === "gateway" ? "rejected" : "17 rules · admitted") : undefined;
    case "miner": return order(run.stage) >= 4 ? "gossiped" : undefined;
    case "block": return run.block ? `block ${run.block} · ${run.gasUsed?.toLocaleString()} gas` : undefined;
  }
}

function Observer({ f, cfg, run }: { f: Facts; cfg: LiveConfig; run: Run | null }) {
  const a = f.agents.find((x) => x.name === cfg.agent);
  const zk = cfg.mode === "zk";
  return (
    <article className="card observer">
      <h2>Who can see what</h2>
      <div className="cols">
        <div className="col private">
          <h3>Owner's private view</h3>
          <dl>
            <dt>agent</dt><dd>{cfg.agent}</dd>
            <dt>owner</dt><dd>you</dd>
            <dt>credential</dt><dd className="mono">{zk ? `commitment ${a?.commitment ? short(BigInt(a.commitment).toString(16), 6) : "…"}` : `one-time key #${run?.keyIndex ?? "?"}`}</dd>
            <dt>secret</dt><dd className="mono">••••••••••••</dd>
            <dt>policy</dt><dd>{cfg.policyName}</dd>
          </dl>
        </div>
        <div className="col public">
          <h3>What the mempool & chain see</h3>
          <dl>
            <dt>sender</dt><dd className="mono">{short(f.deployments.account ?? "")} <span className="dim">shared account, same for everyone</span></dd>
            <dt>payer</dt><dd className="mono">{short(f.deployments.paymaster ?? "")} <span className="dim">paymaster</span></dd>
            <dt>signature</dt><dd>{zk ? <>scheme 0 · <span className="redact">no public key</span></> : <>scheme 1 · one-time key <span className="mono">{run?.keyAddress ? short(run.keyAddress) : "…"}</span></>}</dd>
            <dt>nonce key</dt><dd className="mono">{zk ? (run?.nullifier ? short(run.nullifier, 8) : "…") : run?.keyAddress ? short(run.keyAddress) : "…"} <span className="dim">{zk ? "nullifier: fresh per epoch, unlinkable" : "the key itself"}</span></dd>
            <dt>agent</dt><dd><span className="redact">hidden</span></dd>
            <dt>owner</dt><dd>{zk ? <span className="redact">hidden</span> : <span className="warn">linkable via the key's registration</span>}</dd>
            <dt>which member acted</dt><dd>{zk ? <span className="redact">any of the class</span> : <span className="warn">this one</span>}</dd>
            <dt>policy class</dt><dd>{cfg.policyName} <span className="dim">visible, shared by the class</span></dd>
          </dl>
        </div>
      </div>
    </article>
  );
}

function AnonymitySet({ members, mode, run }: { members: number; mode: "zk" | "key"; run: Run | null }) {
  const n = Math.max(members, 1);
  const dots = useMemo(() => Array.from({ length: Math.min(n, 64) }, (_, i) => i), [n]);
  const acting = run && order(run.stage) >= 1;
  // key mode: a deterministic "revealed" member; zk: everyone pulses alike
  const revealed = mode === "key" && run?.keyIndex !== undefined ? run.keyIndex % dots.length : -1;
  return (
    <article className="card">
      <h2>Anonymity set</h2>
      <p className="lede">{n} member{n === 1 ? "" : "s"} in this policy class. {mode === "zk" ? "When one acts, the proof says only “one of us”." : "When one acts, its one-time key points at a specific registration."}</p>
      <div className={`set ${acting ? "acting" : ""} ${mode}`}>
        {dots.map((i) => <span key={i} className={`m ${i === revealed ? "revealed" : ""}`} />)}
      </div>
      <p className="dim">{acting ? (mode === "zk" ? "which one acted? unknown — all equally likely" : `revealed: the member holding key #${run?.keyIndex}`) : "idle"}</p>
    </article>
  );
}

function History({ f, history }: { f: Facts; history: Run[] }) {
  return (
    <article className="card">
      <h2>This session</h2>
      <table className="feed">
        <thead><tr><th>tx</th><th>mode</th><th>result</th><th>nonce key</th></tr></thead>
        <tbody>
          {history.map((r) => (
            <tr key={r.runId}>
              <td className="mono">{r.hash ? <a href={`${f.explorerUrl}tx/${r.hash}`} target="_blank" rel="noreferrer">{short(r.hash)}</a> : "—"}</td>
              <td><span className={`pill ${r.mode}`}>{r.mode}</span></td>
              <td>{r.failed ? <span className="pill rejected">{r.canonical ? "canonical: rejected" : "refused"}</span> : r.stage === "block" ? <span className="pill included">block {r.block}</span> : <span className="pill">{r.stage}…</span>}</td>
              <td className="mono dim">{r.nullifier ? short(r.nullifier, 6) : r.keyAddress ? short(r.keyAddress) : ""}</td>
            </tr>
          ))}
          {history.length === 0 && <tr><td colSpan={4} className="dim">nothing yet</td></tr>}
        </tbody>
      </table>
    </article>
  );
}

function EventLog({ log }: { log: RunnerEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log.length]);
  return (
    <article className="card">
      <h2>Runner log</h2>
      <div className="log mono" ref={ref}>
        {log.slice(-80).map((e) => (
          <div key={e.id}><span className="dim">{new Date(e.ts).toLocaleTimeString()}</span> <span className="t">{e.type}</span> {summarize(e)}</div>
        ))}
      </div>
    </article>
  );
}

const summarize = (e: RunnerEvent) => {
  const d = e.data;
  switch (e.type) {
    case "act.proved": return `${d.ms} ms · nullifier ${short(d.nullifier, 6)}`;
    case "act.key": return `#${d.index} ${short(d.address)}`;
    case "act.built": case "act.submitted": return short(d.hash);
    case "act.included": return `block ${d.block} · ${d.gasUsed} gas`;
    case "act.rejected": case "act.canonicalRejected": return d.message ?? d.reason;
    case "heartbeat.done": return `epoch ${d.epoch}`;
    case "revoke.done": return `generation ${d.generation}`;
    default: return d.message ?? "";
  }
};
