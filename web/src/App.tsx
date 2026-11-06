import { useEffect, useState } from "react";
import { LiveView } from "./Live";
import { loadFacts, loadFeed, loadOverview, type Admission, type Facts, type Overview } from "./lib/data";
import { FeedView, StackView, StoryView } from "./Views";

type Tab = "live" | "stack" | "feed" | "story";

export function App() {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [feed, setFeed] = useState<Admission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>((location.hash.replace("#", "") as Tab) || "live");
  const [selected, setSelected] = useState<Admission | null>(null);

  useEffect(() => {
    loadFacts().then(setFacts).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!facts) return;
    let alive = true;
    const tick = async () => {
      try {
        const [o, fd] = await Promise.all([loadOverview(facts), loadFeed(facts)]);
        if (!alive) return;
        setOverview(o);
        setFeed(fd);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [facts]);

  const go = (t: Tab) => {
    setTab(t);
    location.hash = t;
  };

  return (
    <div className="page">
      <header>
        <div className="brand">
          <span className="logo">◎</span>
          <div>
            <h1>AnonAI</h1>
            <p>AI agents that act on chain without a key, without ETH, and without a name · EIP-8141 · ERC-8421 alt-mempool</p>
          </div>
        </div>
        <nav>
          {(["live", "stack", "feed", "story"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => go(t)}>
              {t === "live" ? "Live" : t === "stack" ? "Stack" : t === "feed" ? "Mempool feed" : "Story"}
            </button>
          ))}
        </nav>
        <div className="status">{overview ? <span className="ok">● block {overview.block}</span> : <span className="dim">● connecting…</span>}</div>
      </header>

      {error && <div className="banner">{error}</div>}

      {facts && tab === "live" && <LiveView f={facts} o={overview} />}
      {facts && tab === "stack" && <StackView f={facts} o={overview} />}
      {facts && tab === "feed" && <FeedView f={facts} feed={feed} selected={selected} onSelect={setSelected} />}
      {facts && tab === "story" && <StoryView f={facts} />}

      <footer>
        {facts && (
          <>
            chain {facts.chainId} · gateway <code>{facts.gatewayUrl}</code> · explorer <a href={facts.explorerUrl}>{facts.explorerUrl}</a> · facts exported {new Date(facts.generatedAt).toLocaleString()}
          </>
        )}
      </footer>
    </div>
  );
}
