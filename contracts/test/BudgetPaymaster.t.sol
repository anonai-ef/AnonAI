// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BudgetPaymaster} from "../src/BudgetPaymaster.sol";
import {HegotaMocks} from "./Mocks.sol";

contract BudgetPaymasterTest is HegotaMocks {
    event Approved(uint256 scope);

    address account = address(0xACC0);
    address stranger = address(0xBAD);
    bytes32 policy = keccak256("policy-class-1");
    uint256 maxCost = 0.001 ether;

    BudgetPaymaster pm;

    uint256 constant SENDER = 2;
    uint256 constant MAX_COST = 6;
    uint256 constant CURRENT_FRAME_INDEX = 10;
    uint256 constant STATUS = 5;

    function setUp() public {
        pm = new BudgetPaymaster{value: 1 ether}(account);
        mockApprove(address(pm));
        mockTxParam(address(pm), SENDER, uint256(uint160(account)));
        mockTxParam(address(pm), MAX_COST, maxCost);
        mockTxParam(address(pm), CURRENT_FRAME_INDEX, 2); // pay runs as frame 2, right after the pre_verify frame 1
        mockFrameParam(address(pm), 1, STATUS, 1);
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
        vm.expectEmit(address(pm));
        emit Approved(1); // Scope.PAYMENT
        assertTrue(_pay());
    }

    function test_refusesWhenBudgetTooSmall() public {
        pm.fund{value: maxCost - 1}(policy);
        assertFalse(_preVerify());
        assertEq(pm.budget(policy), maxCost - 1);
    }

    function test_refusesOtherSenders() public {
        pm.fund{value: 0.01 ether}(policy);
        mockTxParam(address(pm), SENDER, uint256(uint160(stranger)));
        assertFalse(_preVerify());
        assertEq(pm.budget(policy), 0.01 ether);
    }

    function test_payWithoutChargeFails() public {
        pm.fund{value: 0.01 ether}(policy);
        assertFalse(_pay());
    }

    function test_payAfterFailedPreVerifyFails() public {
        pm.fund{value: 0.01 ether}(policy);
        assertTrue(_preVerify());
        mockFrameParam(address(pm), 1, STATUS, 0); // the node reports the pre_verify frame as failed
        assertFalse(_pay());
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
