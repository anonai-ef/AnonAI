// Everything the scripts generate: the operator key, deployed addresses, registered agents. Git-ignored (holds keys).
import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { loadConfig } from "./config.js";

export interface AgentRecord {
  name: string;
  /** Root secret of the agent; one-time keys are derived from it. Devnet only. */
  secret: Hex;
  policyClass: Hex;
  /** How many one-time keys were registered for it, and how many are used. */
  keys: number;
  used: number;
  /** Leaf index of its first key in the keystore tree; keys follow in order. */
  leafStart: number;
}

export interface State {
  operatorKey?: Hex;
  deployments: Partial<{ paymaster: Address; keystore: Address; account: Address }>;
  agents: Record<string, AgentRecord>;
  lastTx?: Hex;
}

const empty = (): State => ({ deployments: {}, agents: {} });

export function readState(): State {
  const f = loadConfig().stateFile;
  if (!fs.existsSync(f)) return empty();
  return { ...empty(), ...JSON.parse(fs.readFileSync(f, "utf8")) };
}

export function writeState(mutate: (s: State) => void): State {
  const s = readState();
  mutate(s);
  fs.writeFileSync(loadConfig().stateFile, JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  return s;
}

/** The operator (owner-side) key: created on first use. Devnet only; never reuse it elsewhere. */
export function operatorKey(): Hex {
  const s = readState();
  if (s.operatorKey) return s.operatorKey;
  const k = generatePrivateKey();
  writeState((st) => (st.operatorKey = k));
  return k;
}

export const operatorAddress = (): Address => privateKeyToAccount(operatorKey()).address;

export function requireDeployment<K extends keyof State["deployments"]>(k: K): Address {
  const a = readState().deployments[k];
  if (!a) throw new Error(`state: ${k} is not deployed; run the deploy script first`);
  return a;
}
