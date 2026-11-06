// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HegotaSupport} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {Devnet} from "@forshtat/hegota-support/contracts/Devnet.sol";
import {FrameParam, Scope, SigParam, TxParam} from "@forshtat/hegota-support/contracts/Params.sol";

/// Development aid, never part of the product: answers "what does this EIP-8141 opcode return on this devnet?"
/// Used only through ethrex_simulateFrameTransaction. The frame's data is (kind, a, b):
///   kind 0: approve EXECUTION (so an only_verify frame succeeds and later frames run)
///   kind 1: revert with txparam(a)           kind 2: revert with frameparam(a, b)
///   kind 3: revert with sigparam(a, b)       kind 4: revert with tload(a)
///   kind 5: tstore(a, b) then return          kind 6: approve PAYMENT
/// A revert with 32 bytes of data = the opcode worked and that is its value; an empty revert = the opcode faulted.
contract OpcodeProbe is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    constructor() payable {}

    fallback() external payable {
        (uint256 kind, uint256 a, uint256 b) = abi.decode(msg.data, (uint256, uint256, uint256));
        uint256 v;
        if (kind == 0) {
            approve(Scope.EXECUTION);
            return;
        } else if (kind == 1) {
            v = txparam(TxParam(a));
        } else if (kind == 2) {
            v = frameparam(a, FrameParam(b));
        } else if (kind == 3) {
            v = sigparam(a, SigParam(b));
        } else if (kind == 4) {
            assembly ("memory-safe") {
                v := tload(a)
            }
        } else if (kind == 5) {
            assembly ("memory-safe") {
                tstore(a, b)
            }
            return;
        } else if (kind == 6) {
            approve(Scope.PAYMENT);
            return;
        }
        bytes memory out = abi.encode(v);
        assembly ("memory-safe") {
            revert(add(out, 32), mload(out))
        }
    }
}
