// Owner-side CLI.
//   yarn agent new <name> --mode zk|key --class weth-0.01 [--keys 8]   register an agent in a policy class
//   yarn agent revoke <name>                                            remove its leaf/leaves (bumps the class generation)
//   yarn agent heartbeat <class>                                        open a new epoch for the class
//   yarn agent fund <class> <eth>                                       add ETH to the paymaster budget of the class
//   yarn agent treasury <eth>                                           wrap ETH and give the shared account WETH to spend
//   yarn agent list                                                     agents, classes, budgets, treasury
import { formatEther, type Address } from "viem";
import { balance } from "../lib/chain.js";
import { KeystoreClient } from "../lib/keystoreClient.js";
import { budgetOf, fundBudget, heartbeat, registerAgent, revokeAgent, topUpTreasury } from "../lib/owner.js";
import { policyCatalogue } from "../lib/policies.js";
import { policyClassOf } from "../lib/semaphore.js";
import { readState, requireDeployment } from "../lib/state.js";
import { wethBalance } from "../lib/weth.js";

const log = (s: string) => console.error(s);
const flag = (name: string, dflt?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

async function main() {
  const [cmd, a1, a2] = process.argv.slice(2);

  if (cmd === "new") {
    if (!a1) throw new Error("usage: agent new <name> --mode zk|key --class <class> [--keys 8]");
    const r = await registerAgent({ name: a1, mode: flag("mode", "zk") as "zk" | "key", policyName: flag("class", "weth-0.01")!, keys: Number(flag("keys", "8")) }, log);
    log(`registered in tx ${r.txHash}; class root epoch ${r.epoch}`);
    return;
  }
  if (cmd === "revoke") {
    const r = await revokeAgent(a1, log);
    log(`class generation now ${r.generation}`);
    return;
  }
  if (cmd === "heartbeat") {
    await heartbeat(a1, log);
    return;
  }
  if (cmd === "fund") {
    const h = await fundBudget(a1, a2);
    log(`funded ${a1} with ${a2} ETH of gas budget (tx ${h}); budget now ${formatEther(await budgetOf(a1))} ETH`);
    return;
  }
  if (cmd === "treasury") {
    const r = await topUpTreasury(a1);
    log(`shared account now holds ${r.treasuryWeth} WETH (deposit ${r.deposit}, transfer ${r.transfer})`);
    return;
  }
  if (cmd === "list" || !cmd) {
    const st = readState();
    const ks = new KeystoreClient(requireDeployment("keystore"));
    const account = st.deployments.account as Address;
    const pm = st.deployments.paymaster as Address;
    console.log(`account   ${account}  ${formatEther(await balance(account))} ETH  ${formatEther(await wethBalance(account))} WETH`);
    console.log(`paymaster ${pm}  ${formatEther(await balance(pm))} ETH`);
    for (const [name, p] of Object.entries(policyCatalogue())) {
      const c = policyClassOf(p);
      const members = await ks.members(c);
      console.log(`class ${name} ${c.slice(0, 10)}…  members ${members.filter((m) => m !== 0n).length}/${members.length}  epoch ${await ks.rootSeq(c)}  gen ${await ks.generation(c)}  budget ${formatEther(await budgetOf(name))} ETH`);
    }
    for (const a of Object.values(st.agents)) console.log(`agent ${a.name}  ${a.mode}  ${a.policyName}${a.mode === "key" ? `  keys ${a.used}/${a.keys} used` : ""}`);
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
