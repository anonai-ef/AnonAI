// yarn probe
// Deploys OpcodeProbe once and asks ethrex (dry-run only) what the EIP-8141 introspection opcodes return in a
// transaction shaped exactly like AnonAI's: [only_verify, pre_verify, pay, body]. Each query is one simulation whose
// queried frame reverts with the value (32 bytes) or empty (the opcode faulted).
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { deploy } from "../lib/chain.js";
import { loadConfig } from "../lib/config.js";
import { artifact } from "../lib/contracts.js";
import { arbitrarySignature, assemble, encodeRaw, preVerifyFrame, senderFrame, verifyFrame } from "../lib/frameTx.js";
import { rpc } from "../lib/rpc.js";
import { operatorKey, readState, writeState } from "../lib/state.js";
import { accountNonce } from "../lib/staking.js";
import { transferCalldata } from "../lib/weth.js";

const q = (kind: number, a: bigint | number = 0, b: bigint | number = 0): Hex =>
  encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [BigInt(kind), BigInt(a), BigInt(b)]);

async function main() {
  const cfg = loadConfig();
  let probe = (readState() as any).probe as Address | undefined;
  if (!probe) {
    console.error("deploying OpcodeProbe…");
    probe = await deploy(operatorKey(), artifact("OpcodeProbe" as any).bytecode, 0n);
    writeState((s) => ((s as any).probe = probe));
  }
  console.error(`probe ${probe}`);
  const nonce = await accountNonce(probe);

  // frame data per query: [frame0, frame1, frame2]; the queried frame reverts, earlier ones approve / store
  const cases: { name: string; frames: [Hex, Hex, Hex] }[] = [
    { name: "frame0 txparam FRAME_COUNT (9)", frames: [q(1, 9), q(5, 1, 7), q(6)] },
    { name: "frame0 txparam CURRENT_FRAME_INDEX (10)", frames: [q(1, 10), q(5, 1, 7), q(6)] },
    { name: "frame0 txparam NONCE_KEY_COUNT (14)", frames: [q(1, 14), q(5, 1, 7), q(6)] },
    { name: "frame0 txparam NONCE_KEY_0 (16)", frames: [q(1, 16), q(5, 1, 7), q(6)] },
    { name: "frame0 txparam MAX_COST (6)", frames: [q(1, 6), q(5, 1, 7), q(6)] },
    { name: "frame0 frameparam(3, RESOLVED_TARGET)", frames: [q(2, 3, 0), q(5, 1, 7), q(6)] },
    { name: "frame0 frameparam(3, DATA_LENGTH)", frames: [q(2, 3, 4), q(5, 1, 7), q(6)] },
    { name: "frame0 frameparam(3, VALUE)", frames: [q(2, 3, 8), q(5, 1, 7), q(6)] },
    { name: "frame0 frameparam(1, MODE)", frames: [q(2, 1, 2), q(5, 1, 7), q(6)] },
    { name: "frame0 sigparam(0, SCHEME)", frames: [q(3, 0, 1), q(5, 1, 7), q(6)] },
    { name: "frame2 txparam CURRENT_FRAME_INDEX (10)", frames: [q(0), q(5, 1, 7), q(1, 10)] },
    { name: "frame2 frameparam(1, STATUS) after pre_verify tstore", frames: [q(0), q(5, 1, 7), q(2, 1, 5)] },
    { name: "frame2 frameparam(0, STATUS)", frames: [q(0), q(5, 1, 7), q(2, 0, 5)] },
    { name: "frame2 tload(1) after pre_verify tstore(1,7)", frames: [q(0), q(5, 1, 7), q(4, 1)] },
    { name: "frame2 txparam MAX_COST (6)", frames: [q(0), q(5, 1, 7), q(1, 6)] },
    { name: "frame2 txparam SIG_HASH (8)", frames: [q(0), q(5, 1, 7), q(1, 8)] },
    { name: "frame1 (pre_verify) txparam SIG_HASH (8)", frames: [q(0), q(1, 8), q(6)] },
    { name: "frame1 (pre_verify) txparam SENDER (2)", frames: [q(0), q(1, 2), q(6)] },
    { name: "frame2 txparam NONCE_KEY_0 (16)", frames: [q(0), q(5, 1, 7), q(1, 16)] },
  ];

  for (const c of cases) {
    const tx = assemble({
      sender: probe,
      nonceSeq: nonce,
      nonceKeys: [12345n],
      signatures: [arbitrarySignature()],
      frames: [
        verifyFrame("EXECUTION", null, 300_000n, { data: c.frames[0] }),
        preVerifyFrame(probe, 150_000n, { data: c.frames[1] }),
        verifyFrame("PAYMENT", probe, 150_000n, { data: c.frames[2] }),
        senderFrame(cfg.weth, 100_000n, { data: transferCalldata(probe, 0n), state: 100_000n }),
      ],
    });
    // keyed nonce: the probe's keyed seq is 0 for a fresh key
    const keyed = { ...tx, nonceSeq: 0n };
    const r: any = await rpc(cfg.ethrexUrl, "ethrex_simulateFrameTransaction", [encodeRaw(keyed), "latest"]);
    const data: string = r.revertData ?? "0x";
    const value = data.length === 66 ? BigInt(data) : undefined;
    const verdict = value !== undefined ? `value ${value}${value > 2n ** 100n ? ` (0x${value.toString(16)})` : ""}` : `FAULT (${r.executionError ?? r.violation ?? "?"})`;
    console.log(`${c.name.padEnd(52)} failedFrame=${r.failedFrameIndex ?? "-"} ${verdict}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
