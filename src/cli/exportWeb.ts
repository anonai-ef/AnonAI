// yarn export:web
// Writes web/public/anonai.json: the public facts the dashboard needs (addresses, policy classes, agents' public
// data). Never secrets. Run after setup or after registering agents, then rebuild the site.
import fs from "node:fs";
import path from "node:path";
import { formatEther } from "viem";
import { loadConfig, repoRoot } from "../lib/config.js";
import { policyCatalogue } from "../lib/policies.js";
import { policyClassOf } from "../lib/semaphore.js";
import { readState } from "../lib/state.js";

const cfg = loadConfig();
const st = readState();
const out = {
  generatedAt: new Date().toISOString(),
  chainId: cfg.chainId,
  gatewayUrl: cfg.gatewayUrl,
  minerUrl: cfg.minerUrl,
  ethrexUrl: cfg.ethrexUrl,
  explorerUrl: cfg.explorerUrl,
  stakingRegistry: cfg.stakingRegistry,
  recentRootAddress: cfg.recentRootAddress,
  nonceManager: cfg.nonceManager,
  weth: cfg.weth,
  poseidonT3: cfg.poseidonT3,
  deployments: st.deployments,
  policies: Object.entries(policyCatalogue()).map(([name, p]) => ({ name, policyClass: policyClassOf(p), target: p.target, selector: p.selector, maxAmount: formatEther(p.maxAmount), maxValue: formatEther(p.maxValue) })),
  agents: Object.values(st.agents).map((a) => ({ name: a.name, mode: a.mode, policyName: a.policyName, policyClass: a.policyClass, commitment: a.commitment ?? null, keys: a.keys ?? null, used: a.used ?? null })),
  demoRecipient: "0x8943545177806ED17B9F23F0a21ee5948eCaa776",
};
const file = path.join(repoRoot, "web", "public", "anonai.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.error(`wrote ${file}`);
