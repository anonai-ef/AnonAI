// The only configuration source: anonai.config.json5 next to package.json. Read-only for the code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";
import { parseEther, parseGwei, type Address } from "viem";

export interface Config {
  chainId: number;
  gatewayUrl: string;
  ethrexUrl: string;
  explorerUrl: string;
  stakingRegistry: Address;
  recentRootAddress: Address;
  nonceManager: Address;
  usdc: Address;
  weth: Address;
  deterministicProxy: Address;
  poseidonT3: Address;
  stateFile: string;
  maxFeePerGasWei: bigint;
  legacyGasPriceWei: bigint;
  deployGasLimit: bigint;
  heavyDeployGasLimit: bigint;
  stakeWei: bigint;
  unstakeDelaySec: number;
  accountFundingWei: bigint;
  paymasterFundingWei: bigint;
  epochBlocks: number;
  txTimeoutSec: number;
}

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let cached: Config | undefined;
export function loadConfig(): Config {
  if (cached) return cached;
  const raw = JSON5.parse(fs.readFileSync(path.join(repoRoot, "anonai.config.json5"), "utf8"));
  const str = (k: string): string => {
    if (typeof raw[k] !== "string" || !raw[k]) throw new Error(`config: ${k} must be a non-empty string`);
    return raw[k];
  };
  const num = (k: string): number => {
    if (typeof raw[k] !== "number") throw new Error(`config: ${k} must be a number`);
    return raw[k];
  };
  const addr = (k: string): Address => str(k) as Address;
  cached = {
    chainId: num("chainId"),
    gatewayUrl: str("gatewayUrl"),
    ethrexUrl: str("ethrexUrl"),
    explorerUrl: str("explorerUrl"),
    stakingRegistry: addr("stakingRegistry"),
    recentRootAddress: addr("recentRootAddress"),
    nonceManager: addr("nonceManager"),
    usdc: addr("usdc"),
    weth: addr("weth"),
    deterministicProxy: addr("deterministicProxy"),
    poseidonT3: addr("poseidonT3"),
    stateFile: path.join(repoRoot, str("stateFile")),
    maxFeePerGasWei: parseGwei(str("maxFeePerGasGwei")),
    legacyGasPriceWei: parseGwei(str("legacyGasPriceGwei")),
    deployGasLimit: BigInt(num("deployGasLimit")),
    heavyDeployGasLimit: BigInt(num("heavyDeployGasLimit")),
    stakeWei: parseEther(str("stakeEth")),
    unstakeDelaySec: num("unstakeDelaySec"),
    accountFundingWei: parseEther(str("accountFundingEth")),
    paymasterFundingWei: parseEther(str("paymasterFundingEth")),
    epochBlocks: num("epochBlocks"),
    txTimeoutSec: num("txTimeoutSec"),
  };
  return cached;
}
