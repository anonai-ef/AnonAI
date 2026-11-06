// CLI around src/lib/semaphore.ts, used by the forge tests through vm.ffi and handy for debugging.
//   tsx scripts/prove.ts identity <secret>                      -> {"commitment":"<dec>"}
//   tsx scripts/prove.ts siblings <secret> <members-json>       -> {"siblings":["<dec>",…]}
//   tsx scripts/prove.ts prove <secret> <members-json> <message> <scope>
//        -> {"merkleTreeDepth":10,"merkleTreeRoot":"<dec>","nullifier":"<dec>","message":"<dec>","scope":"<dec>","points":["<dec>",…8]}
// Members are a JSON array of decimal or hex strings in Keystore order (revoked = "0"); message and scope are
// decimal or 0x-hex. Numbers are printed as decimal strings (what forge's parseJsonUint reads). Output is one JSON
// line on stdout; everything else goes to stderr so forge can parse stdout.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { commitmentOf, proveMembership, siblingsOf } from "../src/lib/semaphore.js";

const dec = (n: bigint): string => n.toString(10);
const big = (s: string): bigint => BigInt(s);

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "identity") {
    console.log(JSON.stringify({ commitment: dec(commitmentOf(args[0])) }));
    return;
  }
  const members = (JSON.parse(args[1]) as string[]).map(big);
  if (cmd === "siblings") {
    console.log(JSON.stringify({ siblings: siblingsOf(members, commitmentOf(args[0])).map(dec) }));
    return;
  }
  if (cmd === "siblings-of-leaf") {
    // <leaf> <members-json>: for key-mode leaves (one-time addresses) or any raw leaf value
    console.log(JSON.stringify({ siblings: siblingsOf(members, big(args[0])).map(dec) }));
    return;
  }
  if (cmd === "prove") {
    // Proofs are deterministic in their inputs for our purposes, so the test suite caches them on disk
    // (contracts/cache is git-ignored). Delete the directory to force fresh proofs.
    const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "contracts", "cache", "proofs");
    const key = createHash("sha256").update(JSON.stringify([args[0], args[1], big(args[2]).toString(), big(args[3]).toString()])).digest("hex");
    const cacheFile = path.join(cacheDir, `${key}.json`);
    if (fs.existsSync(cacheFile)) {
      console.error(`proof from cache ${cacheFile}`);
      console.log(fs.readFileSync(cacheFile, "utf8").trim());
      return;
    }
    const started = Date.now();
    const p = await proveMembership({ secret: args[0], members, message: big(args[2]), scope: big(args[3]) });
    console.error(`proof generated in ${Date.now() - started} ms`);
    const out = JSON.stringify({
      merkleTreeDepth: p.merkleTreeDepth,
      merkleTreeRoot: dec(p.merkleTreeRoot),
      nullifier: dec(p.nullifier),
      message: dec(p.message),
      scope: dec(p.scope),
      points: p.points.map(dec),
    });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, out + "\n");
    console.log(out);
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

// snarkjs keeps worker threads alive after proving, which would keep this process (and forge's ffi) waiting
// forever, so exit explicitly once the JSON line is out.
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
