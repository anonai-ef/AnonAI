// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HegotaSupport} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {Devnet} from "@forshtat/hegota-support/contracts/Devnet.sol";
import {Scope, SigParam, TxParam} from "@forshtat/hegota-support/contracts/Params.sol";

/// Stateful paymaster for AnonAI: pays gas for the shared account out of per-policy-class budgets.
///
/// Budgets are keyed by a policy class, never by an owner address, so this contract's storage names nobody.
/// Two frames of every agent transaction land here:
///   pre_verify (DEFAULT mode, calldata = policy class): charges the transaction's maximum cost to the budget and
///              records a charge receipt under the transaction's signature hash.
///   pay        (VERIFY mode, empty calldata): requires the receipt for this very transaction, then approves payment.
/// ERC-8421 asks the approving frame to check the pre_verify frame's status through FRAMEPARAM; on this devnet's
/// ethrex that parameter faults and transient storage does not survive between frames, so the receipt, keyed by
/// TXPARAM(SIG_HASH) which is unique per transaction, is the binding instead. It is strictly stronger: payment is
/// approved only if this transaction's own pre_verify frame ran to completion and charged the budget.
/// Reading and writing its own storage during validation requires this contract to be a staked entity
/// (STORAGE-031), and a pre_verify frame is only admitted by the standard alt-mempool.
///
/// Fund the ETH it pays with through the creation `value` or `fund` (never a bare transfer: that hits the fallback).
contract BudgetPaymaster is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    /// The only sender this paymaster sponsors.
    address public immutable account;
    address public immutable admin;
    /// Remaining budget per policy class, in wei of gas it may still sponsor.
    mapping(bytes32 => uint256) public budget;
    /// Charge receipts: signature hash of a transaction => policy class it was charged to (0 = not charged).
    mapping(bytes32 => bytes32) public charged;

    event Funded(bytes32 indexed policyClass, uint256 amount, uint256 total);
    event Charged(bytes32 indexed policyClass, bytes32 indexed sigHash, uint256 maxCost, uint256 remaining);

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
        else if (msg.data.length == 1) _admin();
        else _pay();
    }

    /// Admin self-relay (used once, to stake this paymaster): the tx carries a SECP256K1 signature by the admin.
    function _admin() internal {
        require(address(uint160(sigparam(0, SigParam.RESOLVED_SIGNER))) == admin, "AnonAI: not admin");
        approve(Scope.EXECUTION_AND_PAYMENT);
    }

    function _preVerify(bytes32 policyClass) internal {
        // Nobody is authorised yet when pre_verify runs: only charge for the account we sponsor.
        require(address(uint160(txparam(TxParam.SENDER))) == account, "AnonAI: not the shared account");
        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));
        require(charged[sigHash] == bytes32(0), "AnonAI: already charged");
        uint256 maxCost = txparam(TxParam.MAX_COST);
        uint256 remaining = budget[policyClass];
        require(remaining >= maxCost, "AnonAI: budget exhausted");
        unchecked {
            remaining -= maxCost;
        }
        budget[policyClass] = remaining;
        charged[sigHash] = policyClass;
        emit Charged(policyClass, sigHash, maxCost, remaining);
    }

    function _pay() internal {
        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));
        require(charged[sigHash] != bytes32(0), "AnonAI: not charged");
        approve(Scope.PAYMENT);
    }
}
