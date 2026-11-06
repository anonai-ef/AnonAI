// Owner-side CLI.
//   yarn agent new <name> --mode zk|key --class weth-0.01 [--keys 8]   register an agent in a policy class
//   yarn agent revoke <name>                                            remove its leaf/leaves (bumps the class generation)
//   yarn agent heartbeat <class>                                        open a new epoch for the class
//   yarn agent fund <class> <eth>                                       add ETH to the paymaster budget of the class
//   yarn agent treasury <eth>                                           wrap ETH and give the shared account WETH to spend
//   yarn agent list                                                     agents, classes, budgets, treasury
import { encodeFunctionData, formatEther, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { balance, publicClient, sendLegacy } from "../lib/chain.js";
import { loadConfig } from "../lib/config.js";
import { artifact } from "../lib/contracts.js";
import { leafOfAddress, oneTimeKeys } from "../lib/keys.js";
import { KeystoreClient } from "../lib/keystoreClient.js";
import { policyByName, policyCatalogue } from "../lib/policies.js";
import { commitmentOf, policyClassOf, siblingsOf } from "../lib/semaphore.js";
import { operatorKey, readState, requireDeployment, writeState } from "../lib/state.js";
import { wethBalance, wrapAndSend } from "../lib/weth.js";

const log = (s: string) => console.error(s);
const flag = (name: string, dflt?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

async function main() {
  const cfg = loadConfig();
  const [cmd, a1, a2] = process.argv.slice(2);
  const ks = new KeystoreClient(requireDeployment("keystore"));
  const opKey = operatorKey();

  if (cmd === "new") {
    const name = a1;
    const mode = (flag("mode", "zk") as "zk" | "key");
    const className = flag("class", "weth-0.01")!;
    if (!name) throw new Error("usage: agent new <name> --mode zk|key --class <class>");
    if (readState().agents[name]) throw new Error(`agent ${name} exists`);
    const { policy, policyClass } = policyByName(className);
    const secret = generatePrivateKey(); // just 32 random bytes, used as a seed string
    if (mode === "zk") {
      const commitment = commitmentOf(secret);
      log(`registering ${name} (zk) in ${className}: commitment ${commitment}`);
      const r = await ks.register(opKey, policyClass, [commitment]);
      writeState((s) => (s.agents[name] = { name, mode, secret, policyName: className, policyClass, commitment: commitment.toString() }));
      log(`registered in tx ${r.txHash}; class root epoch ${r.seq}, slot ${r.recentRoot.slot}`);
    } else {
      const n = Number(flag("keys", "8"));
      const keys = oneTimeKeys(secret, n);
      log(`registering ${name} (key) in ${className}: ${n} one-time keys`);
      const r = await ks.register(opKey, policyClass, keys.map((k) => leafOfAddress(k.address)));
      writeState((s) => (s.agents[name] = { name, mode, secret, policyName: className, policyClass, keys: n, used: 0 }));
      log(`registered in tx ${r.txHash}; class root epoch ${r.seq}`);
    }
    void policy;
    return;
  }

  if (cmd === "revoke") {
    const rec = readState().agents[a1];
    if (!rec) throw new Error(`unknown agent ${a1}`);
    if (rec.mode === "zk") {
      const members = await ks.members(rec.policyClass);
      const r = await ks.revoke(opKey, rec.policyClass, BigInt(rec.commitment!), siblingsOf(members, BigInt(rec.commitment!)));
      log(`revoked ${a1} in tx ${r.txHash}; class generation ${await ks.generation(rec.policyClass)}, epoch ${r.seq}`);
    } else {
      const keys = oneTimeKeys(rec.secret, rec.keys!).slice(rec.used ?? 0);
      for (const k of keys) {
        const members = await ks.members(rec.policyClass);
        const leaf = leafOfAddress(k.address);
        if (!members.includes(leaf)) continue;
        const r = await ks.revoke(opKey, rec.policyClass, leaf, siblingsOf(members, leaf));
        log(`revoked key #${k.index} ${k.address} in tx ${r.txHash}`);
      }
    }
    writeState((s) => {
      s.agents[a1].used = s.agents[a1].keys;
    });
    return;
  }

  if (cmd === "heartbeat") {
    const { policyClass } = policyByName(a1);
    const last = await ks.lastCommitBlock(policyClass);
    const epochBlocks = await ks.epochBlocks();
    const head = await publicClient().getBlockNumber();
    if (head < last + epochBlocks) {
      const wait = Number(last + epochBlocks - head);
      log(`too soon: the class committed a root at block ${last}; next heartbeat allowed at block ${last + epochBlocks} (${wait} blocks, ~${wait * 6}s). Waiting…`);
      await new Promise((r) => setTimeout(r, (wait + 1) * 6000));
    }
    const r = await ks.heartbeat(opKey, policyClass);
    log(`heartbeat for ${a1}: epoch ${r.seq} (tx ${r.txHash})`);
    return;
  }

  if (cmd === "fund") {
    const { policyClass } = policyByName(a1);
    const pm = requireDeployment("paymaster");
    const data = encodeFunctionData({ abi: artifact("BudgetPaymaster").abi, functionName: "fund", args: [policyClass] });
    const h = await sendLegacy(opKey, pm, data, parseEther(a2));
    log(`funded ${a1} with ${a2} ETH of gas budget (tx ${h})`);
    return;
  }

  if (cmd === "treasury") {
    const account = requireDeployment("account");
    const r = await wrapAndSend(opKey, account, parseEther(a1));
    log(`shared account now holds ${formatEther(await wethBalance(account))} WETH (deposit ${r.deposit}, transfer ${r.transfer})`);
    return;
  }

  if (cmd === "list" || !cmd) {
    const st = readState();
    const account = st.deployments.account as Address;
    const pm = st.deployments.paymaster as Address;
    console.log(`account   ${account}  ${formatEther(await balance(account))} ETH  ${formatEther(await wethBalance(account))} WETH`);
    console.log(`paymaster ${pm}  ${formatEther(await balance(pm))} ETH`);
    for (const [name, p] of Object.entries(policyCatalogue())) {
      const c = policyClassOf(p);
      const budget = (await publicClient().readContract({ address: pm, abi: artifact("BudgetPaymaster").abi, functionName: "budget", args: [c] })) as bigint;
      const members = await ks.members(c);
      console.log(`class ${name} ${c.slice(0, 10)}…  members ${members.filter((m) => m !== 0n).length}/${members.length}  epoch ${await ks.rootSeq(c)}  gen ${await ks.generation(c)}  budget ${formatEther(budget)} ETH`);
    }
    for (const a of Object.values(st.agents)) {
      console.log(`agent ${a.name}  ${a.mode}  ${a.policyName}${a.mode === "key" ? `  keys ${a.used}/${a.keys} used` : ""}`);
    }
    return;
  }

  throw new Error(`unknown command ${cmd}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
