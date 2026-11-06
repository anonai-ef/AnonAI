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
              <h1>Every AI agent on Ethereum today is a <em>CROPS</em> liability.</h1>
              <ul className="crops bad">
                <li><span className="ltr">C</span><div><strong>Censorship resistance</strong><span>One address. Trivially blacklisted.</span></div></li>
                <li><span className="ltr">O</span><div><strong>Open source</strong><span>Hosted key custody you can't run.</span></div></li>
                <li><span className="ltr">P</span><div><strong>Privacy</strong><span>Every action traced to the owner.</span></div></li>
                <li><span className="ltr">S</span><div><strong>Security</strong><span>A funded hot key on a server.</span></div></li>
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
              <ul className="crops good">
                <li><span className="ltr">C</span><div><strong>Censorship resistance</strong><span>No address to blacklist. Public mempool.</span></div></li>
                <li><span className="ltr">O</span><div><strong>Open source</strong><span>MIT. Redeploy from the repo.</span></div></li>
                <li><span className="ltr">P</span><div><strong>Privacy</strong><span>A proof, a nullifier, a class. No names.</span></div></li>
                <li><span className="ltr">S</span><div><strong>Security</strong><span>No key. No ETH. Policy-bound. Revocable.</span></div></li>
              </ul>
            </div>
            <TxCard variant="anonai" animate />
          </>
        )}

        {beat === "how" && (
          <>
            <div className="beat-copy">
              <p className="kicker">How it works</p>
              <h1>Three parties. One transaction.</h1>
            </div>
            <ol className="flow">
              <li>
                <span className="n">1</span>
                <strong>Owner registers</strong>
                <span>A hidden commitment in the Keystore. One tx to add, one to revoke.</span>
              </li>
              <li>
                <span className="n">2</span>
                <strong>Agent proves</strong>
                <span>Membership, bound to this exact call. Nullifier = nonce key.</span>
              </li>
              <li>
                <span className="n">3</span>
                <strong>Chain executes</strong>
                <span>Alt-mempool admits. Shared account acts. Paymaster pays.</span>
              </li>
            </ol>
          </>
        )}

        {beat === "why" && (
          <>
            <div className="beat-copy">
              <p className="kicker">Why it needs the alt-mempool</p>
              <h1>Too heavy and too stateful for the canonical mempool.</h1>
              <p className="sub">Same bytes, two mempools.</p>
            </div>
            <div className="compare">
              <div className="side bad">
                <p className="h">Canonical mempool · EIP-8141</p>
                <ul>
                  <li>100k gas cap</li>
                  <li>own storage only</li>
                  <li>no stateful paymaster</li>
                </ul>
                <p className="verdict">rejected</p>
              </div>
              <div className="side good">
                <p className="h">Standard alt-mempool · ERC-8421</p>
                <ul>
                  <li>297k gas proof check</li>
                  <li>staked reads of the Keystore</li>
                  <li>pre_verify budget charge</li>
                </ul>
                <p className="verdict">included</p>
              </div>
            </div>
            <p className="footline">Claude via MCP · reads via Anon-RPC · 300 ms proof · live on the devnet · <a href={f.explorerUrl} target="_blank" rel="noreferrer">explorer ↗</a></p>
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
