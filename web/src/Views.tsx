// Secondary views: the stack, the raw mempool feed with admission reports, and the story.
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { loadReceipt, modeOfNonceKey, rpc, short, type Admission, type Facts, type Overview } from "./lib/data";

export function Addr({ a, f }: { a?: string; f: Facts }) {
  if (!a) return <span className="dim">not deployed</span>;
  return (
    <a className="mono" href={`${f.explorerUrl}address/${a}`} target="_blank" rel="noreferrer" title={a}>
      {short(a)}
    </a>
  );
}

export function StackView({ f, o }: { f: Facts; o: Overview | null }) {
  const d = f.deployments;
  return (
    <main>
      <section className="grid">
        <article className="card">
          <h2>Shared account</h2>
          <p className="lede">The one sender every agent acts from. The chain sees this address on every action, never an agent or an owner.</p>
          <dl>
            <dt>address</dt><dd><Addr a={d.account} f={f} /></dd>
            <dt>treasury</dt><dd>{o ? `${o.account.weth} WETH` : "…"}</dd>
            <dt>ETH (for its stake tx only)</dt><dd>{o ? o.account.eth : "…"}</dd>
            <dt>stake</dt><dd>{o ? `${o.account.stake} ETH` : "…"} <span className="dim">· lets its VERIFY frame read the Keystore</span></dd>
          </dl>
        </article>
        <article className="card">
          <h2>Budget paymaster</h2>
          <p className="lede">Pays gas from per-policy-class budgets. Agents hold no ETH. Its storage names classes, not owners.</p>
          <dl>
            <dt>address</dt><dd><Addr a={d.paymaster} f={f} /></dd>
            <dt>gas float</dt><dd>{o ? `${o.paymaster.eth} ETH` : "…"}</dd>
            <dt>stake</dt><dd>{o ? `${o.paymaster.stake} ETH` : "…"} <span className="dim">· lets pre_verify write its own storage</span></dd>
          </dl>
        </article>
        <article className="card">
          <h2>Keystore</h2>
          <p className="lede">One Poseidon Merkle tree of agent commitments per policy class. Every change commits the root to the EIP-8272 recent-root predeploy.</p>
          <dl>
            <dt>address</dt><dd><Addr a={d.keystore} f={f} /></dd>
            <dt>verifier (Semaphore v4, Groth16)</dt><dd><Addr a={d.verifier} f={f} /></dd>
            <dt>PoseidonT3</dt><dd><Addr a={f.poseidonT3} f={f} /></dd>
            <dt>recent roots</dt><dd><Addr a={f.recentRootAddress} f={f} /></dd>
          </dl>
        </article>
      </section>
      <section>
        <h2>Policy classes</h2>
        <p className="lede">An owner registers an agent into a shared class. The anonymity set of an action is the class. Each committed root is one epoch; an agent acts once per epoch.</p>
        <table>
          <thead><tr><th>class</th><th>may call</th><th>cap per action</th><th>members</th><th>epoch</th><th>generation</th><th>gas budget</th><th>root</th></tr></thead>
          <tbody>
            {(o?.classes ?? []).map((c) => (
              <tr key={c.name}>
                <td><strong>{c.name}</strong></td>
                <td>WETH <code>transfer</code></td>
                <td>{f.policies.find((p) => p.name === c.name)?.maxAmount} WETH</td>
                <td>{c.members}<span className="dim">/{c.slots}</span></td>
                <td>{c.epoch}</td>
                <td>{c.generation}</td>
                <td>{c.budget} ETH</td>
                <td className="mono dim">{short(c.root)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Agents (owner's view)</h2>
        <p className="lede">What only the owner knows. On chain there is no list of agents, only commitments and one-time addresses mixed in the class tree.</p>
        <table>
          <thead><tr><th>agent</th><th>mode</th><th>class</th><th>credential</th></tr></thead>
          <tbody>
            {f.agents.map((a) => (
              <tr key={a.name}>
                <td><strong>{a.name}</strong></td>
                <td><span className={`pill ${a.mode}`}>{a.mode === "zk" ? "zero-knowledge proof" : "one-time keys"}</span></td>
                <td>{a.policyName}</td>
                <td className="mono dim">{a.mode === "zk" ? `commitment ${short(BigInt(a.commitment!).toString(16), 8)}` : `${a.used}/${a.keys} keys used`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

export function FeedView({ f, feed, selected, onSelect }: { f: Facts; feed: Admission[]; selected: Admission | null; onSelect: (a: Admission | null) => void }) {
  return (
    <main className="split">
      <section>
        <h2>What the mempool sees</h2>
        <p className="lede">Every shared-account transaction the gateway admitted. Same sender, same payer, same shape; only the nonce key differs.</p>
        <table className="feed">
          <thead><tr><th>when</th><th>tx</th><th>outcome</th><th>authorised by</th><th>nonce key</th></tr></thead>
          <tbody>
            {feed.map((a) => {
              const mode = modeOfNonceKey(a.nonceKeys?.[0]);
              return (
                <tr key={a.txHash} className={selected?.txHash === a.txHash ? "sel" : ""} onClick={() => onSelect(a)}>
                  <td className="dim">{a.at ? new Date(a.at > 1e12 ? a.at : a.at * 1000).toLocaleTimeString() : ""}</td>
                  <td className="mono"><a href={`${f.explorerUrl}tx/${a.txHash}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="open in the devnet explorer">{short(a.txHash)} ↗</a></td>
                  <td><span className={`pill ${a.outcome}`}>{a.outcome}</span></td>
                  <td><span className={`pill ${mode}`}>{mode === "zk" ? "ZK proof · sig scheme 0" : mode === "key" ? "one-time key · sig scheme 1" : "admin (linear nonce)"}</span></td>
                  <td className="mono dim">{a.nonceKeys?.[0] ? short(a.nonceKeys[0], 8) : "0x0"}</td>
                </tr>
              );
            })}
            {feed.length === 0 && <tr><td colSpan={5} className="dim">no admissions from the shared account in the gateway's memory (it clears on restart)</td></tr>}
          </tbody>
        </table>
      </section>
      <aside>{selected ? <Detail f={f} a={selected} /> : <p className="dim">Select a transaction to see the sidecar's rule-by-rule admission report.</p>}</aside>
    </main>
  );
}

export function Detail({ f, a }: { f: Facts; a: Admission }) {
  const [receipt, setReceipt] = useState<any>(undefined);
  const [full, setFull] = useState<any>(undefined);
  useEffect(() => {
    setReceipt(undefined);
    setFull(undefined);
    loadReceipt(f, a.txHash as Hex).then(setReceipt).catch(() => setReceipt(null));
    rpc(f.gatewayUrl, "skandha_explorer_getTransaction", [a.txHash]).then(setFull).catch(() => setFull(null));
  }, [a.txHash]);
  const checks = full?.admission?.checks ?? a.checks ?? [];
  const failed = checks.filter((c: any) => c.verdict === "fail");
  const mode = modeOfNonceKey(a.nonceKeys?.[0]);
  return (
    <div className="detail">
      <h3 className="mono">{short(a.txHash, 10)}</h3>
      <p><a href={`${f.explorerUrl}tx/${a.txHash}`} target="_blank" rel="noreferrer">open in the devnet explorer ↗</a></p>
      <dl>
        <dt>sender</dt><dd className="mono">{short(a.sender)} <span className="dim">(shared account)</span></dd>
        <dt>payer</dt><dd className="mono">{short(f.deployments.paymaster ?? "")} <span className="dim">(budget paymaster)</span></dd>
        <dt>authorised by</dt><dd>{mode === "zk" ? "a Semaphore membership proof; signature scheme 0 (ARBITRARY): no public key anywhere" : mode === "key" ? "a one-time secp256k1 key registered in the Keystore; signature scheme 1" : "the admin (self-relay)"}</dd>
        <dt>nonce key</dt><dd className="mono">{a.nonceKeys?.[0] ?? "0x0"}</dd>
        <dt>verdict</dt><dd>{a.outcome}{a.errorMessage ? ` · ${a.errorMessage}` : ""}</dd>
        <dt>receipt</dt><dd>{receipt === undefined ? "…" : receipt ? `block ${parseInt(receipt.blockNumber)} · gas ${parseInt(receipt.gasUsed)} · frames ${(receipt.frameReceipts ?? []).map((x: any) => (x.status === "0x1" ? "✓" : "✗")).join(" ")}` : "not mined"}</dd>
      </dl>
      <h4>Admission report ({checks.length - failed.length} passed{failed.length ? `, ${failed.length} failed` : ""})</h4>
      <ul className="checks">
        {checks.map((c: any, i: number) => (
          <li key={i} className={c.verdict}>
            <span className="rule">{c.rule}</span>
            {c.entity && <span className="dim"> {c.entity}</span>}
            {c.detail && <span className="dim"> — {decodeRevert(c.detail)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function decodeRevert(s: string): string {
  return s.replace(/0x08c379a0[0-9a-f]+/gi, (hex) => {
    try {
      const body = hex.slice(10);
      const len = parseInt(body.slice(64, 128), 16);
      const bytes = body.slice(128, 128 + len * 2).match(/.{2}/g)!.map((b) => parseInt(b, 16));
      return `Error("${new TextDecoder().decode(new Uint8Array(bytes))}")`;
    } catch {
      return hex;
    }
  });
}

export function StoryView({ f }: { f: Facts }) {
  void f;
  const cards = [
    { k: "zk", n: "0", t: "keys", d: "Authorisation is a zero-knowledge proof. Signature scheme 0: nothing to steal, nothing to leak." },
    { k: "pay", n: "0", t: "ETH on the agent", d: "A paymaster pays gas from a budget the owner set, per policy class." },
    { k: "one", n: "1", t: "sender for every agent", d: "All actions leave one shared account. The anonymity set is the whole policy class." },
    { k: "nonce", n: "1", t: "action per epoch", d: "The nullifier is the nonce key. The chain enforces the limit, not the agent." },
    { k: "revoke", n: "1 tx", t: "to revoke", d: "The owner drops the leaf; the agent's next proof dies in frame 0." },
    { k: "alt", n: "297k", t: "gas to verify", d: "Too heavy and too stateful for the canonical mempool. Only the alt-mempool admits it." },
  ];
  return (
    <main className="story-screen">
      <header className="story-head">
        <img src="./logo-mark.png" alt="" />
        <div>
          <p className="eyebrow">AnonAI · EIP-8141 frame transactions · ERC-8421 alt-mempool</p>
          <h1>An AI agent with <span className="hl">no key</span>, <span className="hl2">no ETH</span>, <span className="hl3">no name</span>.</h1>
          <p className="tag">It proves it's allowed to act. The chain never learns who did.</p>
        </div>
      </header>

      <section className="story-grid">
        {cards.map((c) => (
          <article key={c.k} className={`scard ${c.k}`}>
            <div className="num">{c.n}</div>
            <div className="ttl">{c.t}</div>
            <p>{c.d}</p>
          </article>
        ))}
      </section>

      <section className="story-strip">
        <div className="strip-l">
          <p className="eyebrow">What the mempool sees</p>
          <div className="chips">
            <span className="chip">sender · shared account</span>
            <span className="chip">payer · paymaster</span>
            <span className="chip">signature · none</span>
            <span className="chip">nonce key · nullifier</span>
            <span className="chip hidden">agent · HIDDEN</span>
            <span className="chip hidden">owner · HIDDEN</span>
          </div>
        </div>
        <div className="strip-r">
          <p className="eyebrow">In the box</p>
          <p className="facts">Claude drives it through <strong>MCP</strong> · reads leave via <strong>Anon-RPC</strong> · proof in <strong>300 ms</strong> · <strong>4</strong> frames · live on the devnet</p>
        </div>
      </section>
    </main>
  );
}
