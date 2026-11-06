# AnonAI: instructions for agents working in this repo

Read `README.md` for what exists and how to run it, and `docs/SPEC.md` for the decisions, verified devnet
facts, measured gas and open items. Follow SPEC section 14 ("Rules for the building agent").

Quick facts:

- Devnet chain 1337. Gateway (sidecar) `https://altmempoolgateway.forshtat.com/rpc`; miner sidecar
  `https://altmempool.forshtat.com/rpc`; ethrex `https://altmempool.forshtat.com`; explorer
  `https://explorer.altmempool.wtf/`. Config lives only in `anonai.config.json5`; generated keys, addresses and
  agent secrets in `.anonai-state.json` (git-ignored, devnet only).
- Build and test: `forge build --root contracts`, `forge test --root contracts --threads 1` (FFI proofs),
  `./node_modules/.bin/tsc --noEmit`, `yarn --cwd web build`. Install with `yarn install --ignore-engines`.
  After contract changes: `yarn build:contracts` (artifacts are committed) and redeploy with
  `yarn setup --redeploy <name>`.
- Runtime pieces: CLIs in `src/cli`, MCP server `src/mcp/server.ts` (launcher `bin/anonai-mcp`), local runner
  `src/runner/server.ts` (port 8787, SSE events the dashboard animates), dashboard in `web/`
  (`yarn export:web` refreshes its facts file).
- Terminology: sidecar, gateway, canonical mempool, standard alt-mempool, staked entity, reputation.
- Never: the genesis/relayer key, the predeploy deployer key, `debug_*` methods,
  `ethrex_submitPrivilegedFrameTransaction`, environment opcodes in validation frames, guessing at
  rejections (run `yarn debug <hash>`).
- Gotchas: snarkjs leaves worker threads alive (CLIs must `process.exit`); forge mangles remappings whose path
  ends in `.sol` (LeanIMT is vendored); PoseidonT3 is deployed from poseidon-solidity's prebuilt bytecode via
  the CREATE2 proxy, never from our build; gas for deploys and Keystore writes is estimated (state gas);
  `FRAMEPARAM STATUS` faults and transient storage does not cross frames on this ethrex.
- Shell: use absolute paths; the working directory is not stable between parallel calls.
- Commits: small, one deliverable each, build green, message ends with
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
