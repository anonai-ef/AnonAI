// The policy-class catalogue. Owners register agents into one of these shared classes (docs/SPEC.md 4.1, D5).
import { parseEther, toFunctionSelector, type Hex } from "viem";
import { loadConfig } from "./config.js";
import { policyClassOf, type Policy } from "./semaphore.js";

export const TRANSFER_SELECTOR = toFunctionSelector("transfer(address,uint256)") as Hex;

export function policyCatalogue(): Record<string, Policy> {
  const cfg = loadConfig();
  return {
    // WETH9 transfers up to 0.01 WETH per action (the demo class)
    "weth-0.01": { target: cfg.weth, selector: TRANSFER_SELECTOR, maxValue: 0n, maxAmount: parseEther("0.01") },
    // WETH9 transfers up to 0.1 WETH per action
    "weth-0.1": { target: cfg.weth, selector: TRANSFER_SELECTOR, maxValue: 0n, maxAmount: parseEther("0.1") },
  };
}

export function policyByName(name: string): { policy: Policy; policyClass: Hex } {
  const policy = policyCatalogue()[name];
  if (!policy) throw new Error(`unknown policy class ${name}; known: ${Object.keys(policyCatalogue()).join(", ")}`);
  return { policy, policyClass: policyClassOf(policy) };
}

export function policyNameOf(policyClass: Hex): string | undefined {
  return Object.entries(policyCatalogue()).find(([, p]) => policyClassOf(p).toLowerCase() === policyClass.toLowerCase())?.[0];
}
