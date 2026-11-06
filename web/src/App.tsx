import { useEffect, useState } from "react";
import { HomeView } from "./Home";
import { LiveView } from "./Live";
import { disableAnon, enableAnon, getAnonState, NETWORKS, subscribeAnon, type AnonState, type NetworkId } from "./lib/anon";
import { loadFacts, loadFeed, loadOverview, type Admission, type Facts, type Overview } from "./lib/data";
import { StoryView } from "./Story";
import { FeedView, StackView } from "./Views";

type Tab = "home" | "live" | "stack" | "feed" | "story";

export function App() {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [feed, setFeed] = useState<Admission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>((location.hash.replace("#", "") as Tab) || "home");
  const [selected, setSelected] = useState<Admission | null>(null);

  useEffect(() => {
    loadFacts().then(setFacts).catch((e) => setError(e.message));
    const onHash = () => setTab(((location.hash.replace("#", "") as Tab) || "home") as Tab);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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
          <img className="logo" src="./logo-mark.png" alt="AnonAI" />
          <div>
            <h1>AnonAI</h1>
            <p>Full-stack privacy for autonomous AI agents</p>
          </div>
        </div>
        <AnonToggle />
        <nav>
          {(["home", "live", "stack", "feed", "story"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => go(t)}>
              {t === "home" ? "Home" : t === "live" ? "Live" : t === "stack" ? "Stack" : t === "feed" ? "Mempool feed" : "Story"}
            </button>
          ))}
        </nav>
        <div className="status">{overview ? <span className="ok">● block {overview.block}</span> : <span className="dim">● connecting…</span>}</div>
      </header>

      {error && <div className="banner">{error}</div>}

      {facts && tab === "home" && <HomeView f={facts} go={go} />}
      {facts && tab === "live" && <LiveView f={facts} o={overview} />}
      {facts && tab === "stack" && <StackView f={facts} o={overview} />}
      {facts && tab === "feed" && <FeedView f={facts} feed={feed} selected={selected} onSelect={setSelected} />}
      {facts && tab === "story" && <StoryView f={facts} />}

      {tab !== "story" && <AnonBar />}
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

function useAnon(): AnonState {
  const [s, setS] = useState(getAnonState());
  useEffect(() => subscribeAnon(setS), []);
  return s;
}

/** Header switch: route every read this page makes through an Anon-RPC worker. */
function AnonToggle() {
  const s = useAnon();
  const [net, setNet] = useState<NetworkId>("tor-js");
  return (
    <div className={`anon-toggle ${s.status}`}>
      <span className="dot" />
      <span className="lbl">Private reads</span>
      {s.enabled ? (
        <>
          <span className="st">{s.status === "booting" ? `bootstrapping ${NETWORKS[s.network].label}…` : s.status === "ready" ? `via ${NETWORKS[s.network].label} · ${s.requests} reqs` : `failed: ${s.error?.slice(0, 60)}`}</span>
          <button onClick={disableAnon}>Off</button>
        </>
      ) : (
        <>
          <select value={net} onChange={(e) => setNet(e.target.value as NetworkId)}>
            {(Object.keys(NETWORKS) as NetworkId[]).map((k) => <option key={k} value={k}>{NETWORKS[k].label}</option>)}
          </select>
          <button onClick={() => enableAnon(net)}>On</button>
        </>
      )}
    </div>
  );
}

/** What the RPC provider sees for this page's reads, direct vs anonymised. */
function AnonBar() {
  const s = useAnon();
  if (!s.enabled && s.direct === 0) return null;
  const total = s.requests + s.direct;
  const share = total ? Math.round((s.requests / total) * 100) : 0;
  return (
    <section className="card anonbar">
      <div className="row between">
        <div>
          <h2>Read path · Anon-RPC</h2>
          <p className="lede">
            {s.enabled
              ? `This page's RPC and explorer reads leave through a hash-pinned ${NETWORKS[s.network].label} worker in a null-origin sandbox. The devnet providers see an exit address, not this browser. ${NETWORKS[s.network].note}`
              : "Reads are going directly to the devnet providers, which therefore see this browser's IP and which addresses it watches. Turn on private reads in the header."}
          </p>
        </div>
        <div className="counter"><span className="n">{share}%</span><span>of reads anonymised</span></div>
        <div className="counter"><span className="n">{s.requests}</span><span>via worker</span></div>
        <div className="counter"><span className="n">{s.direct}</span><span>direct</span></div>
      </div>
      {s.logs.length > 0 && <div className="log mono small">{s.logs.map((l, i) => <div key={i}>{l}</div>)}</div>}
    </section>
  );
}
