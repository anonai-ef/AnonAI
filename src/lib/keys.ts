// One-time keys for key mode: derived from the agent secret, one per action, never reused.
import { concat, keccak256, numberToHex, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface OneTimeKey {
  index: number;
  privateKey: Hex;
  address: Address;
}

/** privKey_i = keccak256(secret || uint32(i)). Devnet only; a production design would use a proper KDF. */
export function oneTimeKey(secret: string, index: number): OneTimeKey {
  const privateKey = keccak256(concat([toBytes(secret), numberToHex(index, { size: 4 })]));
  return { index, privateKey, address: privateKeyToAccount(privateKey).address };
}

export const oneTimeKeys = (secret: string, count: number, start = 0): OneTimeKey[] =>
  Array.from({ length: count }, (_, i) => oneTimeKey(secret, start + i));

/** The Keystore leaf of a one-time key: its address as a number. */
export const leafOfAddress = (a: Address): bigint => BigInt(a);
