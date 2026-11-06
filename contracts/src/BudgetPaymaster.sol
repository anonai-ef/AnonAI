// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HegotaSupport} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {Devnet} from "@forshtat/hegota-support/contracts/Devnet.sol";
import {FrameParam, Scope, TxParam} from "@forshtat/hegota-support/contracts/Params.sol";

/// Stateful paymaster for AnonAI: pays gas for the shared account out of per-policy-class budgets.
///
/// Budgets are keyed by a policy class, never by an owner address, so this contract's storage names nobody.
/// Two frames of every agent transaction land here:
///   pre_verify (DEFAULT mode, calldata = policy class): charges the transaction's maximum cost to the budget.
///   pay        (VERIFY mode, empty calldata): checks that the pre_verify frame succeeded, then approves payment.
/// Reading its own storage during validation requires this contract to be a staked entity (STORAGE-031), and a
/// pre_verify frame is only admitted by the standard alt-mempool: the canonical mempool rejects this shape outright.
///
/// Fund the ETH it pays with through the creation `value` or `fund` (never a bare transfer: that hits the fallback).
contract BudgetPaymaster is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    /// The only sender this paymaster sponsors.
    address public immutable account;
    address public immutable admin;
    /// Remaining budget per policy class, in wei of gas it may still sponsor.
    mapping(bytes32 => uint256) public budget;

    /// Transient flag set by pre_verify and read by pay, so payment can only follow a charge in the same transaction.
    uint256 private constant ARMED_SLOT = uint256(keccak256("anonai.paymaster.armed"));
    uint256 private constant FRAME_STATUS_SUCCESS = 1;

    event Funded(bytes32 indexed policyClass, uint256 amount, uint256 total);
    event Charged(bytes32 indexed policyClass, uint256 maxCost, uint256 remaining);

    constructor(address account_) payable {
        account = account_;
        admin = msg.sender;
    }

    function fund(bytes32 policyClass) external payable {
        budget[policyClass] += msg.value;
        emit Funded(policyClass, msg.value, budget[policyClass]);
    }

    function withdraw(address payable to, uint256 amount) external {
        require(msg.sender == admin, "AnonAI: not admin");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "AnonAI: withdraw failed");
    }

    /// Frames land here. The frame's data is the calldata.
    fallback() external payable {
        if (msg.data.length == 32) _preVerify(abi.decode(msg.data, (bytes32)));
        else _pay();
    }

    function _preVerify(bytes32 policyClass) internal {
        // Nobody is authorised yet when pre_verify runs: only charge for the account we sponsor.
        require(address(uint160(txparam(TxParam.SENDER))) == account, "AnonAI: not the shared account");
        uint256 maxCost = txparam(TxParam.MAX_COST);
        uint256 remaining = budget[policyClass];
        require(remaining >= maxCost, "AnonAI: budget exhausted");
        unchecked {
            remaining -= maxCost;
        }
        budget[policyClass] = remaining;
        uint256 slot = ARMED_SLOT;
        assembly ("memory-safe") {
            tstore(slot, 1)
        }
        emit Charged(policyClass, maxCost, remaining);
    }

    function _pay() internal {
        // A failed DEFAULT frame does not invalidate the transaction, so the approving frame checks it (ERC-8421).
        uint256 index = txparam(TxParam.CURRENT_FRAME_INDEX);
        require(index > 0 && frameparam(index - 1, FrameParam.STATUS) == FRAME_STATUS_SUCCESS, "AnonAI: pre_verify failed");
        uint256 armed;
        uint256 slot = ARMED_SLOT;
        assembly ("memory-safe") {
            armed := tload(slot)
        }
        require(armed == 1, "AnonAI: not charged");
        approve(Scope.PAYMENT);
    }
}
