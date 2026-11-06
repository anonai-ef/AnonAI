# AnonAI: instructions for agents working in this repo

Read `docs/SPEC.md` first. It is the build specification: decisions, verified devnet facts, the
transaction frame layout, validation logic, privacy analysis, gas budget, build plan and fallbacks.
Follow its section 14 ("Rules for the building agent") exactly.

Quick facts:

- Devnet chain 1337. Gateway (sidecar) `https://altmempoolgateway.forshtat.com/rpc`; ethrex
  `https://altmempool.forshtat.com`; explorer `https://explorer.altmempool.wtf/`. Config lives only in
  `anonai.config.json5`; generated keys/addresses in `.anonai-state.json` and `agents/` (git-ignored).
- Build: `forge build --root contracts`, `forge test --root contracts`, `./node_modules/.bin/tsc --noEmit`.
  Install with `yarn install --ignore-engines` (Node 25 trips vitest); prefer Node 22 for the prover.
- Terminology: sidecar, gateway, canonical mempool, standard alt-mempool, staked entity, reputation.
- Never: the genesis/relayer key, `debug_*` methods, `ethrex_submitPrivilegedFrameTransaction`,
  environment opcodes in validation frames, guessing at rejections (read the admission report).
- Shell: use absolute paths; the working directory is not stable between calls.
- Commits: small, one deliverable each, build green, message ends with
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
