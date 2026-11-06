// WETH9 on the devnet: the asset the demo agents pay with (anyone can wrap devnet ETH).
import { encodeFunctionData, type Address, type Hex } from "viem";
import { publicClient, sendLegacy } from "./chain.js";
import { loadConfig } from "./config.js";

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

export const wethBalance = (a: Address): Promise<bigint> =>
  publicClient().readContract({ address: loadConfig().weth, abi: ERC20_ABI, functionName: "balanceOf", args: [a] }) as Promise<bigint>;

export const transferCalldata = (to: Address, amount: bigint): Hex => encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [to, amount] });

/** Operator wraps `amount` ETH and sends the WETH to `to` (the shared account's treasury). */
export async function wrapAndSend(operatorKey: Hex, to: Address, amount: bigint): Promise<{ deposit: Hex; transfer: Hex }> {
  const weth = loadConfig().weth;
  const deposit = await sendLegacy(operatorKey, weth, encodeFunctionData({ abi: ERC20_ABI, functionName: "deposit" }), amount);
  const transfer = await sendLegacy(operatorKey, weth, transferCalldata(to, amount));
  return { deposit, transfer };
}
