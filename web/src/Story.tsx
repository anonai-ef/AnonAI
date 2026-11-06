// Story: four beats on one screen, advanced with arrows, keys or autoplay. One accent colour; red only for
// "exposed", green only for "hidden".
import { useEffect, useState } from "react";
import type { Facts } from "./lib/data";

type Beat = "problem" | "idea" | "how" | "why";
const BEATS: Beat[] = ["problem", "idea", "how", "why"];

export function StoryView({ f }: { f: Facts }) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(false);
  const beat = BEATS[i];
  const next = () => setI((x) => (x + 1) % BEATS.length);
  const prev = () => setI((x) => (x - 1 + BEATS.length) % BEATS.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(next, 7000);
    return () => clearInterval(id);
  }, [auto]);

  return (
    <main className="story">
      <div className="story-nav">
        <div className="dots">
          {BEATS.map((b, k) => (
            <button key={b} className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={b}>
              <span className="k">{k + 1}</span>
              <span className="l">{{ problem: "The problem", idea: "The idea", how: "How it works", why: "Why the alt-mempool" }[b]}</span>
            </button>
          ))}
        </div>
        <div className="arrows">
          <button onClick={() => setAuto((a) => !a)}>{auto ? "Pause" : "Autoplay"}</button>
          <button onClick={prev} aria-label="previous">←</button>
          <button onClick={next} aria-label="next">→</button>
        </div>
      </div>

      <section key={beat} className={`beat beat-${beat}`}>
        {beat === "problem" && (
          <>
            <div className="beat-copy">
              <p className="kicker">The problem</p>
              <h1>Every AI agent on Ethereum today is a liability.</h1>
              <ul className="points">
                <li><span className="ico">⚿</span><div><strong>It holds a private key on a server.</strong><span>One prompt injection, one leaked env var, and the key is gone.</span></div></li>
                <li><span className="ico">Ξ</span><div><strong>It holds ETH for gas.</strong><span>Every agent address is a funded honeypot.</span></div></li>
                <li><span className="ico">◎</span><div><strong>It acts from one public address.</strong><span>Every trade, payment and read is traced to its owner.</span></div></li>
              </ul>
            </div>
            <TxCard variant="today" />
          </>
        )}

        {beat === "idea" && (
          <>
            <div className="beat-copy">
              <p className="kicker">The idea</p>
              <h1>Replace the key with a <em>proof</em>, the balance with a <em>budget</em>, the address with a <em>crowd</em>.</h1>
              <p className="sub">
                The owner registers the agent as a hidden commitment. The agent proves it is one of the registered, binds the proof to this exact action, and sends from an account shared by every agent. A paymaster pays. The chain sees a proof, a nullifier and a policy class. Nothing names the agent or the owner.
              </p>
            </div>
            <TxCard variant="anonai" animate />
          </>
        )}

        {beat === "how" && (
          <>
            <div className="beat-copy">
              <p className="kicker">How it works</p>
              <h1>Three parties. One transaction.</h1>
              <p className="sub">Built on EIP-8141 frame transactions: four frames, each with its own job.</p>
            </div>
            <ol className="flow">
              <li>
                <span className="n">1</span>
                <strong>Owner registers</strong>
                <span>A Semaphore commitment goes into the Keystore's class tree. The root is committed to the recent-root predeploy. One transaction to add, one to revoke.</span>
              </li>
              <li>
                <span className="n">2</span>
                <strong>Agent proves</strong>
                <span>A Groth16 membership proof, bound to the call it is about to make. Its nullifier becomes the transaction's nonce key: one action per epoch, enforced by the chain.</span>
              </li>
              <li>
                <span className="n">3</span>
                <strong>Mempool admits, chain executes</strong>
                <span>Frame 0 verifies the proof and the policy. The paymaster charges its budget and approves payment. The shared account makes the call.</span>
              </li>
            </ol>
          </>
        )}

        {beat === "why" && (
          <>
            <div className="beat-copy">
              <p className="kicker">Why it needs the alt-mempool</p>
              <h1>Too heavy and too stateful for the canonical mempool.</h1>
              <p className="sub">Same bytes, two mempools. We send both in the demo.</p>
            </div>
            <div className="compare">
              <div className="side bad">
                <p className="h">Canonical mempool · EIP-8141</p>
                <ul>
                  <li>100,000 gas validation cap</li>
                  <li>sender's own storage only</li>
                  <li>no stateful paymaster</li>
                </ul>
                <p className="verdict">rejected</p>
              </div>
              <div className="side good">
                <p className="h">Standard alt-mempool · ERC-8421</p>
                <ul>
                  <li>296,823 gas to verify the proof</li>
                  <li>staked account reads the Keystore</li>
                  <li>pre_verify charges the budget</li>
                </ul>
                <p className="verdict">included</p>
              </div>
            </div>
            <p className="footline">Claude drives it through MCP · the dashboard reads through Anon-RPC · proof in 300 ms · live on the devnet · <a href={f.explorerUrl} target="_blank" rel="noreferrer">explorer ↗</a></p>
          </>
        )}
      </section>
    </main>
  );
}

/** A transaction as the mempool sees it. "today": an ordinary agent wallet. "anonai": the same payment from AnonAI. */
function TxCard({ variant, animate }: { variant: "today" | "anonai"; animate?: boolean }) {
  const today = variant === "today";
  type Row = { k: string; v: string; tag: string; exposed?: boolean; hidden?: boolean };
  const rows: Row[] = today
    ? [
        { k: "from", v: "0x8a3f…c21e", tag: "the agent's address", exposed: true },
        { k: "signed by", v: "ECDSA · the agent's private key", tag: "stealable", exposed: true },
        { k: "gas paid by", v: "the agent · 0.42 ETH on it", tag: "honeypot", exposed: true },
        { k: "nonce", v: "17", tag: "links every action", exposed: true },
        { k: "to", v: "WETH · transfer(supplier, 0.002)", tag: "" },
      ]
    : [
        { k: "from", v: "0xf7df…7db6", tag: "shared account, same for every agent", hidden: true },
        { k: "signed by", v: "scheme 0 · a zero-knowledge proof", tag: "no key exists", hidden: true },
        { k: "gas paid by", v: "the paymaster · class budget", tag: "agent holds 0 ETH", hidden: true },
        { k: "nonce key", v: "nullifier · fresh per epoch", tag: "unlinkable", hidden: true },
        { k: "to", v: "WETH · transfer(supplier, 0.002)", tag: "" },
      ];
  return (
    <div className={`txcard ${variant} ${animate ? "animate" : ""}`}>
      <div className="txhead">
        <span>{today ? "Transaction · agent wallet today" : "Transaction · AnonAI"}</span>
        <span className={today ? "badge bad" : "badge good"}>{today ? "owner identifiable" : "owner hidden"}</span>
      </div>
      {rows.map((r, idx) => (
        <div key={r.k} className={`txrow ${r.exposed ? "exposed" : ""} ${r.hidden ? "hidden" : ""}`} style={{ animationDelay: `${0.25 + idx * 0.35}s` }}>
          <span className="k">{r.k}</span>
          <span className="v mono">{r.v}</span>
          {r.tag && <span className="t">{r.tag}</span>}
        </div>
      ))}
    </div>
  );
}
