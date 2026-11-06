// Home: what AnonAI is, how to give Claude the AnonAI tools, and prompts to try.
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

function Block({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <div className="codeblock">
      <pre className="mono">{children}</pre>
      <Copy text={text} />
    </div>
  );
}

export function HomeView({ f, go }: { f: Facts; go: (t: any) => void }) {
  const install = `git clone ${REPO} && cd AnonAI
yarn install --ignore-engines
yarn setup                                  # deploys + stakes your own stack on the devnet (or reuse ours)
yarn agent new claude --mode zk --class weth-0.01
yarn agent fund weth-0.01 0.05 && yarn agent treasury 0.05`;
  const addClaude = `claude mcp add anonai -- "$PWD/bin/anonai-mcp" --agent claude`;
  const desktop = `{
  "mcpServers": {
    "anonai": { "command": "/ABS/PATH/AnonAI/bin/anonai-mcp", "args": ["--agent", "claude"] }
  }
}`;
  const prompts = [
    `Use AnonAI: check the treasury's WETH balance, then pay 0.002 WETH to ${f.demoRecipient}. Tell me the tx hash, the block, who the chain saw as sender and payer, and which signature scheme it carried.`,
    `Send the exact same payment through the canonical mempool with anonai_act_canonical and explain, from the rejection text, why only the alt-mempool admits it.`,
    `Pay 0.002 WETH again right away. If it fails, explain what a nullifier is and why one action per epoch is enforced by the protocol rather than by you.`,
    `Call anonai_whoami and describe, as the owner's auditor, everything an observer of the mempool can and cannot learn about you.`,
  ];
  return (
    <main className="home">
      <section className="hero home-hero">
        <div className="hero-copy">
          <h2>Give Claude a wallet that is not a wallet.</h2>
          <p className="lede big">
            AnonAI lets an AI agent act on chain with <strong>no private key, no ETH and no name</strong>. The agent proves it is allowed to act with a zero-knowledge
            membership proof, sends from one shared account, and a paymaster pays its gas from a budget the owner set. Nothing on chain says which agent, or whose.
          </p>
          <div className="row">
            <button className="primary" onClick={() => go("live")}>Watch it run live</button>
            <button onClick={() => go("feed")}>See what the mempool sees</button>
            <a className="btn" href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
          </div>
        </div>
        <div className="hero-facts">
          <div><span className="n">0</span><span>ETH held by the agent</span></div>
          <div><span className="n">0</span><span>keys in the transaction</span></div>
          <div><span className="n">≈300 ms</span><span>to prove</span></div>
          <div><span className="n">4</span><span>frames per action</span></div>
        </div>
      </section>

      <section className="grid two">
        <article className="card">
          <h2>1 · Install the AnonAI MCP for Claude</h2>
          <p className="lede">The MCP server gives Claude five tools: <code>anonai_whoami</code>, <code>anonai_read</code>, <code>anonai_act</code>, <code>anonai_act_canonical</code>, <code>anonai_status</code>. It keeps the agent's secret on your machine; Claude never sees it.</p>
          <h3>Set up once</h3>
          <Block text={install}>{install}</Block>
          <h3>Add to Claude Code</h3>
          <Block text={addClaude}>{addClaude}</Block>
          <p className="dim">or drop <code>demo/.mcp.json</code> into any project; run <code>claude</code> inside <code>demo/</code> to start with the agent instructions in <code>demo/CLAUDE.md</code>.</p>
          <h3>Add to Claude Desktop</h3>
          <Block text={desktop}>{desktop}</Block>
          <p className="dim">Node 22+ and yarn. Devnet chain 1337; the faucet funds the owner key with 1 ETH per hour.</p>
        </article>

        <article className="card">
          <h2>2 · Prompts to drop into Claude</h2>
          <p className="lede">Each one is a complete instruction. Claude reads state first, acts, and reports what the chain saw.</p>
          <ol className="prompts">
            {prompts.map((p, i) => (
              <li key={i}>
                <p>{p}</p>
                <Copy text={p} />
              </li>
            ))}
          </ol>
          <h3>What Claude will report back</h3>
          <ul>
            <li>the transaction hash and block, linked on this site to the <a href={f.explorerUrl} target="_blank" rel="noreferrer">devnet explorer</a></li>
            <li>sender = the shared account <code>{f.deployments.account?.slice(0, 10)}…</code>, payer = the budget paymaster</li>
            <li>signature scheme 0: a proof and a nullifier, no public key</li>
            <li>on a second action in the same epoch: a nonce-key refusal, by the protocol</li>
          </ul>
        </article>
      </section>

      <section className="grid three">
        <article className="card"><h2>Keystore</h2><p className="lede">Owners register agents as hidden commitments, one Poseidon tree per policy class. Every change commits the root to the EIP-8272 recent-root predeploy.</p></article>
        <article className="card"><h2>Shared account</h2><p className="lede">Frame 0 verifies a Semaphore Groth16 proof, checks the policy against the call, and approves. The nullifier is the EIP-8250 nonce key: one action per epoch, enforced by the chain.</p></article>
        <article className="card"><h2>Budget paymaster</h2><p className="lede">A pre_verify frame charges the class budget and records a receipt; the pay frame approves only against that receipt. Only the standard alt-mempool admits this shape.</p></article>
      </section>
    </main>
  );
}
