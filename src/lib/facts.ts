// The public facts the dashboard needs (addresses, policy classes, agents' public data). Never secrets.
import { formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config.js";
import { policyCatalogue } from "./policies.js";
import { policyClassOf } from "./semaphore.js";
import { readState } from "./state.js";

export const DEMO_RECIPIENT = "0x8943545177806ED17B9F23F0a21ee5948eCaa776";

export function publicFacts() {
  const cfg = loadConfig();
  const st = readState();
  return {
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
    // the owner's public address: it registers agents and funds budgets; it never appears in an agent's action
    operator: st.operatorKey ? privateKeyToAccount(st.operatorKey).address : null,
    policies: Object.entries(policyCatalogue()).map(([name, p]) => ({ name, policyClass: policyClassOf(p), target: p.target, selector: p.selector, maxAmount: formatEther(p.maxAmount), maxValue: formatEther(p.maxValue) })),
    agents: Object.values(st.agents).map((a) => ({ name: a.name, mode: a.mode, policyName: a.policyName, policyClass: a.policyClass, commitment: a.commitment ?? null, keys: a.keys ?? null, used: a.used ?? null })),
    demoRecipient: DEMO_RECIPIENT,
  };
}
