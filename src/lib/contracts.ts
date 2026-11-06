// Compiled artifacts (committed under contracts/artifacts) and library linking.
import fs from "node:fs";
import path from "node:path";
import type { Abi, Address, Hex } from "viem";
import { repoRoot } from "./config.js";

export interface Artifact {
  abi: Abi;
  bytecode: Hex;
  linkReferences: Record<string, Record<string, { start: number; length: number }[]>>;
}

export type ContractName = "BudgetPaymaster" | "Keystore" | "SharedAccount" | "SemaphoreVerifier";

export function artifact(name: ContractName): Artifact {
  const file = path.join(repoRoot, "contracts", "artifacts", `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`missing artifact ${file}: run \`yarn build:contracts\``);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Artifact;
}

/** Replaces every `__$…$__` placeholder of the named libraries with their deployed address. */
export function linkBytecode(a: Artifact, libraries: Record<string, Address>): Hex {
  let code = a.bytecode.slice(2);
  for (const [, libs] of Object.entries(a.linkReferences)) {
    for (const [libName, refs] of Object.entries(libs)) {
      const addr = libraries[libName];
      if (!addr) throw new Error(`no address for linked library ${libName}`);
      const hex = addr.slice(2).toLowerCase().padStart(40, "0");
      for (const { start, length } of refs) {
        if (length !== 20) throw new Error(`unexpected link length ${length}`);
        code = code.slice(0, start * 2) + hex + code.slice(start * 2 + 40);
      }
    }
  }
  if (code.includes("__$")) throw new Error("unlinked placeholder left in bytecode");
  return `0x${code}`;
}
