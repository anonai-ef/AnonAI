// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BudgetPaymaster} from "../src/BudgetPaymaster.sol";
import {HegotaMocks} from "./Mocks.sol";

contract BudgetPaymasterTest is HegotaMocks {
    event Approved(uint256 scope);

    address account = address(0xACC0);
    address stranger = address(0xBAD);
    bytes32 policy = keccak256("policy-class-1");
    bytes32 sigHash = keccak256("tx-1");
    uint256 maxCost = 0.001 ether;

    BudgetPaymaster pm;

    uint256 constant TX_SIG_HASH = 8;

    function setUp() public {
        pm = new BudgetPaymaster{value: 1 ether}(account);
        mockApprove(address(pm));
        mockTxParam(address(pm), TX_SENDER, uint256(uint160(account)));
        mockTxParam(address(pm), TX_MAX_COST, maxCost);
        mockTxParam(address(pm), TX_SIG_HASH, uint256(sigHash));
    }

    function _preVerify() internal returns (bool ok) {
        (ok,) = address(pm).call(abi.encode(policy));
    }

    function _pay() internal returns (bool ok) {
        (ok,) = address(pm).call("");
    }

    function test_chargesBudgetThenApprovesPayment() public {
        pm.fund{value: 0.01 ether}(policy);
        assertTrue(_preVerify());
        assertEq(pm.budget(policy), 0.01 ether - maxCost);
        assertEq(pm.charged(sigHash), policy);
        vm.expectEmit(address(pm));
        emit Approved(1); // Scope.PAYMENT
        assertTrue(_pay());
    }

    function test_refusesWhenBudgetTooSmall() public {
        pm.fund{value: maxCost - 1}(policy);
        assertFalse(_preVerify());
        assertEq(pm.budget(policy), maxCost - 1);
        assertFalse(_pay());
    }

    function test_refusesOtherSenders() public {
        pm.fund{value: 0.01 ether}(policy);
        mockTxParam(address(pm), TX_SENDER, uint256(uint160(stranger)));
        assertFalse(_preVerify());
        assertEq(pm.budget(policy), 0.01 ether);
    }

    function test_payWithoutChargeFails() public {
        pm.fund{value: 0.01 ether}(policy);
        assertFalse(_pay());
    }

    function test_payForAnotherTransactionsChargeFails() public {
        pm.fund{value: 0.01 ether}(policy);
        assertTrue(_preVerify());
        mockTxParam(address(pm), TX_SIG_HASH, uint256(keccak256("tx-2"))); // a different transaction
        assertFalse(_pay());
    }

    function test_cannotChargeTwiceForOneTransaction() public {
        pm.fund{value: 0.01 ether}(policy);
        assertTrue(_preVerify());
        assertFalse(_preVerify());
        assertEq(pm.budget(policy), 0.01 ether - maxCost);
    }

    function test_adminPathApprovesBothScopesForAdminOnly() public {
        mockSigner(address(pm), address(this));
        vm.expectEmit(address(pm));
        emit Approved(3);
        (bool ok,) = address(pm).call(hex"01");
        assertTrue(ok);
        mockSigner(address(pm), stranger);
        (ok,) = address(pm).call(hex"01");
        assertFalse(ok);
    }

    function test_onlyAdminWithdraws() public {
        vm.prank(stranger);
        vm.expectRevert();
        pm.withdraw(payable(stranger), 1);
        uint256 before = address(this).balance;
        pm.withdraw(payable(address(this)), 0.5 ether);
        assertEq(address(this).balance, before + 0.5 ether);
    }

    receive() external payable {}
}
