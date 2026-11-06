// Home: the pitch in one breath, how to give Claude the AnonAI tools, and prompts to paste.
import { useState } from "react";
import type { Facts } from "./lib/data";

const REPO = "https://github.com/anonai-ef/AnonAI";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

function Block({ text }: { text: string }) {
  return (
    <div className="codeblock">
      <pre className="mono">{text}</pre>
      <Copy text={text} />
    </div>
  );
}

export function HomeView({ f, go }: { f: Facts; go: (t: any) => void }) {
  const install = `git clone ${REPO} && cd AnonAI && yarn install --ignore-engines
yarn setup && yarn agent new claude --mode zk --class weth-0.01
yarn agent fund weth-0.01 0.05 && yarn agent treasury 0.05`;
  const addClaude = `claude mcp add anonai -- "$PWD/bin/anonai-mcp" --agent claude`;
  const desktop = `"anonai": { "command": "/ABS/PATH/AnonAI/bin/anonai-mcp", "args": ["--agent", "claude"] }`;
  const prompts = [
    `Use AnonAI: check the treasury's WETH balance, then pay 0.002 WETH to ${f.demoRecipient}. Report the tx hash, block, sender, payer and signature scheme.`,
    `Send the same payment with anonai_act_canonical and explain from the rejection why only the alt-mempool admits it.`,
    `Pay again right away. If it fails, explain the nullifier and why the chain, not you, enforces one action per epoch.`,
  ];
  return (
    <main className="home">
      <section className="hero home-hero">
        <div className="hero-copy">
          <p className="eyebrow">Full-stack privacy for autonomous AI agents</p>
          <h2>Give Claude a wallet that isn't a wallet.</h2>
          <p className="lede big">
            No private key. No ETH. No name. The agent proves it may act with a zero-knowledge proof, sends from a shared account, and a paymaster pays.
          </p>
          <div className="row">
            <button className="primary" onClick={() => go("live")}>Watch it run</button>
            <button onClick={() => go("story")}>The story</button>
            <a className="btn" href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
          </div>
        </div>
        <div className="hero-facts">
          <div className="zk"><span className="n">0</span><span>keys</span></div>
          <div className="key"><span className="n">0</span><span>ETH on the agent</span></div>
          <div className="ok"><span className="n">300ms</span><span>to prove</span></div>
          <div className="acc"><span className="n">4</span><span>frames per action</span></div>
        </div>
      </section>

      <section className="grid two">
        <article className="card accent-zk">
          <p className="eyebrow">Step 1</p>
          <h2>Install the AnonAI MCP</h2>
          <p className="lede">Five tools for Claude: <code>whoami</code>, <code>read</code>, <code>act</code>, <code>act_canonical</code>, <code>status</code>. The agent secret never leaves your machine.</p>
          <h3>Set up once</h3>
          <Block text={install} />
          <h3>Claude Code</h3>
          <Block text={addClaude} />
          <h3>Claude Desktop · <span className="dim">claude_desktop_config.json → mcpServers</span></h3>
          <Block text={desktop} />
        </article>

        <article className="card accent-key">
          <p className="eyebrow">Step 2</p>
          <h2>Paste a prompt</h2>
          <ol className="prompts">
            {prompts.map((p, i) => (
              <li key={i}>
                <p>{p}</p>
                <Copy text={p} />
              </li>
            ))}
          </ol>
          <h3>Claude reports back</h3>
          <div className="chips">
            <span className="chip">tx hash → <a href={f.explorerUrl} target="_blank" rel="noreferrer">explorer</a></span>
            <span className="chip">sender · shared account</span>
            <span className="chip">payer · paymaster</span>
            <span className="chip">signature · scheme 0</span>
            <span className="chip hidden">agent · HIDDEN</span>
          </div>
        </article>
      </section>
    </main>
  );
}
