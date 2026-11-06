# AnonAI

Anonymous, gas-sponsored on-chain actions for AI agents, built on EIP-8141 frame transactions and the
ERC-8421 standard alt-mempool (public devnet, chain 1337).

An agent proves it is authorised with a **Semaphore v4 zero-knowledge membership proof** instead of a
signature, acts from **one shared account** that many agents of many owners use, pays gas from a
**per-policy-class paymaster budget**, and uses its **nullifier as an EIP-8250 nonce key**. The Keystore
commits every root to the **EIP-8272 recent-root predeploy**. Nothing on chain names the agent or its
owner. A second, cheaper mode (`key`: one fresh secp256k1 key per action) runs under 60k validation
gas and shows, side by side, what the proof hides.

- Build specification (decisions, verified devnet facts, frames, validation, privacy, measured gas, plan):
  [`docs/SPEC.md`](docs/SPEC.md)
- Dashboard (stack, live mempool feed with admission reports, story): `web/`
- Agent instructions for working in this repo: [`CLAUDE.md`](CLAUDE.md)

## Status

Live on the devnet (2026-11-06): both modes mined end to end, canonical rejection reproduced,
rate limit and revocation demonstrated. Measured: zk VERIFY 296,823 gas, key VERIFY 53,591,
pre_verify 42,127, pay 27,437; proof generation ~300 ms.

## Quickstart (owner side)

```sh
yarn install --ignore-engines          # Node 22+ (25 works; vitest dislikes odd versions)
yarn build:contracts                   # optional: forge build + export artifacts (committed)
yarn setup                             # faucet, PoseidonT3 (proxy), verifier, Keystore, account, paymaster, stake both
yarn agent fund weth-0.01 0.02         # gas budget for the policy class
yarn agent treasury 0.05               # wrap ETH and give the shared account WETH to spend
yarn agent new alice --mode zk  --class weth-0.01
yarn agent new bob   --mode key --class weth-0.01 --keys 8
yarn act alice 0x8943545177806ED17B9F23F0a21ee5948eCaa776 0.001        # proof -> alt-mempool -> mined
yarn act alice 0x8943545177806ED17B9F23F0a21ee5948eCaa776 0.001 --canonical   # same bytes to ethrex: rejected
yarn agent heartbeat weth-0.01         # new epoch (one action per agent per epoch)
yarn agent revoke alice                # bumps the class generation; old proofs are refused in frame 0
yarn debug <txHash>                    # the sidecar's rule-by-rule admission report
yarn simulate alice <to> <amount>      # ethrex dry run with per-frame gas
```

State (operator key, addresses, agent secrets) lives in `.anonai-state.json` (git-ignored, devnet only).
If the devnet is reset: `yarn setup --fresh`, then register agents again.

## The agent (Claude + MCP)

`src/mcp/server.ts` exposes `anonai_whoami`, `anonai_read`, `anonai_act`, `anonai_act_canonical`,
`anonai_status`. Install it for Claude Code with one command (after `yarn setup` and `yarn agent new claude --mode zk --class weth-0.01`):

```sh
claude mcp add anonai -- "$PWD/bin/anonai-mcp" --agent claude
```

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{ "mcpServers": { "anonai": { "command": "/ABS/PATH/AnonAI/bin/anonai-mcp", "args": ["--agent", "claude"] } } }
```

Then a prompt such as: *"Use AnonAI: check the treasury's WETH balance, then pay 0.002 WETH to
0x8943545177806ED17B9F23F0a21ee5948eCaa776. Tell me the tx hash, the block, who the chain saw as
sender and payer, and which signature scheme it carried."* `demo/.mcp.json` and `demo/CLAUDE.md`
give the same setup plus the agent's instruction block; run `claude` inside `demo/`.

## Dashboard

```sh
yarn export:web            # writes web/public/anonai.json (addresses, classes, agents' public data)
yarn --cwd web install --ignore-engines
yarn --cwd web dev         # or: yarn --cwd web build -> web/dist (static, deploy anywhere)
```

`.github/workflows/pages.yml` publishes `web/dist` to GitHub Pages on push to `main` (enable Pages with
source "GitHub Actions" once). The site reads the devnet directly from the browser.

## Transaction shape

| # | frame | target | does |
|---|---|---|---|
| 0 | only_verify (VERIFY) | SharedAccount | policy checks, nonce-key binding, Keystore root/generation check, Groth16 verify (zk) or one-time key membership (key), `APPROVE(EXECUTION)` |
| 1 | pre_verify (DEFAULT) | BudgetPaymaster | charge `budget[class] -= MAX_COST`, write a charge receipt under `SIG_HASH` |
| 2 | pay (VERIFY) | BudgetPaymaster | require the receipt, `APPROVE(PAYMENT)` |
| 3 | body (SENDER) | WETH | the action, `msg.sender` = SharedAccount |

`nonceKeys = [nullifier]` (zk) or `[oneTimeAddress]` (key), `nonceSeq = 0`;
`recentRootReferences = [{ keccak(keystore‖class), slot, root }]`; signature scheme 0 (zk) or 1 (key).

## CROPS

**C** We control the Keystore, SharedAccount and BudgetPaymaster and nothing else; an owner redeploys all
three from this repo. Transactions go to the public decentralised mempool, never a private endpoint.
**O** MIT; everything builds and runs from the repo against the public devnet.
**P** The chain learns a policy class, a nullifier and a root; the sidecar also learns the submitting IP.
Nothing learns which agent or which owner acted. No analytics, no trackers.
**S** The operator key signs only Keystore and paymaster transactions; the agent holds one Semaphore
identity secret bounded by its policy and void after revocation. Trust: Semaphore's Groth16 setup, the
verifier contract, the devnet staking registry.

## Layout

```
contracts/src      Keystore, SharedAccount, BudgetPaymaster (+ OpcodeProbe, a dev aid)   contracts/test  forge tests (real proofs via FFI)
src/lib            config, state, rpc, chain, frameTx, anonTx, semaphore, keys, keystoreClient, staking, weth, policies
src/cli            setup, agent, act, simulate, debug, probe, exportWeb         src/mcp/server.ts  the agent's tools
web/               dashboard (Vite + React)                                   docs/SPEC.md       the build specification
```
