// Copies ABI, creation bytecode and library link references of the contracts the CLI deploys into
// contracts/artifacts/<Name>.json. The artifacts are committed, so the TypeScript side runs without foundry.
import fs from "node:fs";
import path from "node:path";

const names = ["BudgetPaymaster", "Keystore", "SharedAccount", "SemaphoreVerifier"];
fs.mkdirSync("contracts/artifacts", { recursive: true });
for (const name of names) {
  const out = path.join("contracts/out", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(out)) throw new Error(`missing ${out}: run forge build --root contracts first`);
  const j = JSON.parse(fs.readFileSync(out, "utf8"));
  if (!j.bytecode?.object || j.bytecode.object === "0x") throw new Error(`${name} has no creation bytecode`);
  fs.writeFileSync(
    path.join("contracts/artifacts", `${name}.json`),
    JSON.stringify({ abi: j.abi, bytecode: j.bytecode.object, linkReferences: j.bytecode.linkReferences ?? {} }, null, 1) + "\n",
  );
  console.log("exported", name);
}
