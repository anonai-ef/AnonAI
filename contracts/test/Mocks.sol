// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

/// The test EVM has no EIP-8141 opcodes. HegotaSupport's constructor creates one helper per opcode in a fixed order,
/// so their addresses are known. Helpers take raw abi-encoded operands (no selector) and answer one word, so
/// `vm.mockCall` on (helper, operands) stands in for an opcode result; an operand nobody mocked falls through to the
/// real Yul helper, whose opcode is invalid here, and reverts. APPROVE runs by delegatecall, so it gets etched code.
/// Order on ERC8421_WORKSHOP: Approve 1, TxParam 2, FrameDataLoad 3, FrameDataCopy 4, FrameParam 5, SigParam 6, SigDataCopy 7.
abstract contract HegotaMocks is Test {
    uint256 internal constant APPROVE_NONCE = 1;
    uint256 internal constant TXPARAM_NONCE = 2;
    uint256 internal constant FRAMEDATALOAD_NONCE = 3;
    uint256 internal constant FRAMEPARAM_NONCE = 5;
    uint256 internal constant SIGPARAM_NONCE = 6;

    function helperOf(address account, uint256 nonce) internal pure returns (address) {
        return vm.computeCreateAddress(account, nonce);
    }

    function mockApprove(address account) internal {
        vm.etch(helperOf(account, APPROVE_NONCE), address(new MockApprove()).code);
    }

    function mockTxParam(address account, uint256 id, uint256 value) internal {
        vm.mockCall(helperOf(account, TXPARAM_NONCE), abi.encode(id), abi.encode(value));
    }

    function mockFrameParam(address account, uint256 frameIndex, uint256 param, uint256 value) internal {
        vm.mockCall(helperOf(account, FRAMEPARAM_NONCE), abi.encode(frameIndex, param), abi.encode(value));
    }

    function mockSigner(address account, address signer) internal {
        vm.mockCall(helperOf(account, SIGPARAM_NONCE), abi.encode(uint256(0), uint256(0)), abi.encode(uint256(uint160(signer))));
    }

    function mockFrameDataWord(address account, uint256 offset, uint256 frameIndex, bytes32 word) internal {
        vm.mockCall(helperOf(account, FRAMEDATALOAD_NONCE), abi.encode(offset, frameIndex), abi.encode(word));
    }
}

contract MockApprove {
    event Approved(uint256 scope);

    fallback() external payable {
        emit Approved(abi.decode(msg.data, (uint256)));
    }
}
