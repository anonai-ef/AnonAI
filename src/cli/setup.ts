// yarn setup [--fresh]
// Deploys and stakes everything AnonAI needs on the devnet, idempotently:
//   PoseidonT3 (prebuilt, via the deterministic proxy) -> SemaphoreVerifier -> Keystore (linked) ->
//   SharedAccount (funded through creation) -> BudgetPaymaster (funded through creation) -> stake both.
// --fresh redeploys our four contracts (after a devnet reset, or to get fresh entities / reputation).
import { encodeDeployData, formatEther, parseEther, type Address, type Hex } from "viem";
import poseidon from "poseidon-solidity";
import { balance, code, deploy, faucet, sendLegacy } from "../lib/chain.js";
import { loadConfig } from "../lib/config.js";
import { artifact, linkBytecode } from "../lib/contracts.js";
import { getStake, stakeEntity } from "../lib/staking.js";
import { operatorAddress, operatorKey, readState, writeState, type State } from "../lib/state.js";

const log = (s: string) => console.error(s);
const hasCode = async (a: Address) => {
  const c = await code(a);
  return !!c && c !== "0x";
};

async function main() {
  const cfg = loadConfig();
  const fresh = process.argv.includes("--fresh");
  const key = operatorKey();
  const me = operatorAddress();

  log(`operator ${me}`);
  let bal = await balance(me);
  if (bal < parseEther("0.3")) {
    log(`balance ${formatEther(bal)} ETH: asking the faucet…`);
    try {
      await faucet(me);
    } catch (e) {
      log(`faucet refused: ${(e as Error).message}`);
    }
    bal = await balance(me);
  }
  log(`balance ${formatEther(bal)} ETH`);
  if (bal < parseEther("0.15")) throw new Error("not enough ETH to set up; fund the operator and retry");

  // 1. PoseidonT3: the library the Keystore's LeanIMT links against. Prebuilt bytecode through the CREATE2 proxy,
  //    so it lands at the same address on every chain (our own build of it is over the contract size limit).
  if (await hasCode(cfg.poseidonT3)) {
    log(`PoseidonT3 already at ${cfg.poseidonT3}`);
  } else {
    log("deploying PoseidonT3 through the deterministic proxy…");
    await sendLegacy(key, cfg.deterministicProxy, poseidon.PoseidonT3.data as Hex);
    if (!(await hasCode(cfg.poseidonT3))) throw new Error("PoseidonT3 did not land at the expected address");
    log(`PoseidonT3 deployed at ${cfg.poseidonT3}`);
  }

  const state = readState();
  // --redeploy paymaster,account forces specific contracts; --fresh forces all four
  const forced = (process.argv[process.argv.indexOf("--redeploy") + 1] ?? "").split(",").filter((s) => s && process.argv.includes("--redeploy"));
  const stale = async (k: keyof State["deployments"]) => fresh || forced.includes(k) || !state.deployments[k] || !(await hasCode(state.deployments[k]!));
  const remember = (k: keyof State["deployments"], a: Address) => writeState((s) => (s.deployments[k] = a));

  // 2. SemaphoreVerifier (stateless Groth16 verifier with keys for depths 1..32).
  if (await stale("verifier")) {
    log("deploying SemaphoreVerifier…");
    remember("verifier", await deploy(key, artifact("SemaphoreVerifier").bytecode));
  }
  const verifier = readState().deployments.verifier!;
  log(`SemaphoreVerifier ${verifier}`);

  // 3. Keystore, linked against PoseidonT3.
  if (fresh || (await stale("keystore"))) {
    log("deploying Keystore…");
    const a = artifact("Keystore");
    const data = encodeDeployData({ abi: a.abi, bytecode: linkBytecode(a, { PoseidonT3: cfg.poseidonT3 }), args: [BigInt(cfg.epochBlocks)] });
    remember("keystore", await deploy(key, data));
  }
  const keystore = readState().deployments.keystore!;
  log(`Keystore ${keystore}`);

  // 4. SharedAccount, funded through its creation value (a later plain transfer would hit its frame fallback).
  if (fresh || (await stale("account"))) {
    log("deploying SharedAccount…");
    const a = artifact("SharedAccount");
    const data = encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args: [keystore, verifier] });
    remember("account", await deploy(key, data, cfg.accountFundingWei));
  }
  const account = readState().deployments.account!;
  log(`SharedAccount ${account}`);

  // 5. BudgetPaymaster, sponsoring only the SharedAccount, funded with a gas float.
  if (fresh || (await stale("paymaster"))) {
    log("deploying BudgetPaymaster…");
    const a = artifact("BudgetPaymaster");
    const data = encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args: [account] });
    remember("paymaster", await deploy(key, data, cfg.paymasterFundingWei));
  }
  const paymaster = readState().deployments.paymaster!;
  log(`BudgetPaymaster ${paymaster}`);

  // 6. Stake both entities (staked: foreign read-only storage for the account, own storage for the paymaster).
  for (const [name, entity] of [["SharedAccount", account], ["BudgetPaymaster", paymaster]] as const) {
    const s = await getStake(entity);
    if (s.amount >= cfg.stakeWei) {
      log(`${name} already staked ${formatEther(s.amount)} ETH`);
      continue;
    }
    log(`staking ${name} with ${formatEther(cfg.stakeWei)} ETH (self-relay through the alt-mempool)…`);
    const h = await stakeEntity(key, entity);
    const after = await getStake(entity);
    log(`${name} staked: ${formatEther(after.amount)} ETH, unstake delay ${after.unstakeDelay}s (tx ${h})`);
  }

  const d = readState().deployments;
  log("");
  log("setup complete");
  log(`  operator       ${me} (${formatEther(await balance(me))} ETH)`);
  log(`  PoseidonT3     ${cfg.poseidonT3}`);
  log(`  verifier       ${d.verifier}`);
  log(`  keystore       ${d.keystore}`);
  log(`  account        ${d.account} (${formatEther(await balance(d.account!))} ETH)`);
  log(`  paymaster      ${d.paymaster} (${formatEther(await balance(d.paymaster!))} ETH)`);
  log(`  explorer       ${cfg.explorerUrl}`);
  console.log(JSON.stringify({ operator: me, ...d, poseidonT3: cfg.poseidonT3 }));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
