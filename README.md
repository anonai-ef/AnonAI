# AnonAI

Anonymous, gas-sponsored on-chain actions for AI agents, built on EIP-8141 frame transactions and the
ERC-8421 standard alt-mempool (public devnet, chain 1337).

An agent proves it is authorised with a Semaphore zero-knowledge membership proof instead of a
signature, acts from one shared account that many agents of many owners use, pays gas from a
per-policy-class paymaster budget, and uses its nullifier as an EIP-8250 nonce key. Nothing on chain
names the agent or its owner.

- Build specification (decisions, verified devnet facts, frames, validation, privacy, gas, plan):
  [`docs/SPEC.md`](docs/SPEC.md)
- Agent instructions for this repo: [`CLAUDE.md`](CLAUDE.md)

Status: M0 done (toolchain, TypeScript foundation, BudgetPaymaster with tests). Next: Keystore, SharedAccount.
