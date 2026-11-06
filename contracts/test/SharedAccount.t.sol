// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SharedAccount} from "../src/SharedAccount.sol";
import {Keystore} from "../src/Keystore.sol";
import {SemaphoreVerifier} from "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";
import {HegotaMocks} from "./Mocks.sol";
import {RecentRootRecorder} from "./Keystore.t.sol";

/// End-to-end authorisation tests. ZK mode uses REAL Semaphore v4 proofs: the TypeScript prover (scripts/prove.ts)
/// runs through vm.ffi and the real SemaphoreVerifier checks the proof on the test EVM. Key mode uses the protocol's
/// resolved signer (mocked SIGPARAM). The EIP-8141 opcode helpers are mocked to describe the frames of a transaction.
contract SharedAccountTest is HegotaMocks {
    event Approved(uint256 scope);

    bytes4 constant TRANSFER = bytes4(keccak256("transfer(address,uint256)"));

    Keystore ks;
    SemaphoreVerifier ver;
    SharedAccount acc;

    address usdc = address(0x05DC);
    address supplier = address(0x5055);
    string aliceSecret = "alice-secret";
    string bobSecret = "bob-secret";
    uint256 aliceC;
    uint256 bobC;
    uint256[] members;

    // key mode: one-time keys registered as leaves (their addresses)
    address oneTime1 = address(0x0A11);
    address oneTime2 = address(0x0A22);
    uint256[] keyMembers;

    SharedAccount.Policy policy;
    bytes32 CLASS;

    function setUp() public {
        RecentRootRecorder rec = new RecentRootRecorder();
        vm.etch(address(0x0000000000000000000000000000000000008272), address(rec).code);

        ks = new Keystore(5);
        ver = new SemaphoreVerifier();
        acc = new SharedAccount(address(ks), address(ver));
        mockApprove(address(acc));

        policy = SharedAccount.Policy({target: usdc, selector: TRANSFER, maxValue: 0, maxAmount: 10e6});
        CLASS = acc.policyClassOf(policy);

        aliceC = _identity(aliceSecret);
        bobC = _identity(bobSecret);
        members.push(aliceC);
        members.push(bobC);
        keyMembers.push(uint256(uint160(oneTime1)));
        keyMembers.push(uint256(uint160(oneTime2)));
        ks.register(CLASS, members);
        ks.register(CLASS, keyMembers);
        // both kinds of leaves live in the same class tree
        for (uint256 i = 0; i < keyMembers.length; i++) members.push(keyMembers[i]);
    }

    // ------------------------------------------------------------------------------------------------ ffi ------

    function _tsx(string[] memory tail) internal returns (string memory) {
        string[] memory cmd = new string[](2 + tail.length);
        cmd[0] = "../node_modules/.bin/tsx";
        cmd[1] = "../scripts/prove.ts";
        for (uint256 i = 0; i < tail.length; i++) cmd[2 + i] = tail[i];
        return string(vm.ffi(cmd));
    }

    function _identity(string memory secret) internal returns (uint256) {
        string[] memory t = new string[](2);
        t[0] = "identity";
        t[1] = secret;
        return vm.parseJsonUint(_tsx(t), ".commitment");
    }

    function _membersJson() internal view returns (string memory s) {
        s = "[";
        for (uint256 i = 0; i < members.length; i++) {
            s = string.concat(s, i == 0 ? "" : ",", '"', vm.toString(members[i]), '"');
        }
        s = string.concat(s, "]");
    }

    function _siblings(string memory secret) internal returns (uint256[] memory) {
        string[] memory t = new string[](3);
        t[0] = "siblings";
        t[1] = secret;
        t[2] = _membersJson();
        return vm.parseJsonUintArray(_tsx(t), ".siblings");
    }

    function _prove(string memory secret, uint256 message, uint256 scope) internal returns (SharedAccount.ZkAuth memory a) {
        string[] memory t = new string[](5);
        t[0] = "prove";
        t[1] = secret;
        t[2] = _membersJson();
        t[3] = vm.toString(message);
        t[4] = vm.toString(scope);
        string memory json = _tsx(t);
        a.policy = policy;
        a.merkleTreeDepth = vm.parseJsonUint(json, ".merkleTreeDepth");
        a.merkleTreeRoot = vm.parseJsonUint(json, ".merkleTreeRoot");
        a.nullifier = vm.parseJsonUint(json, ".nullifier");
        a.scope = vm.parseJsonUint(json, ".scope");
        uint256[] memory pts = vm.parseJsonUintArray(json, ".points");
        for (uint256 i = 0; i < 8; i++) a.points[i] = pts[i];
        assertEq(vm.parseJsonUint(json, ".message"), message);
    }

    // ---------------------------------------------------------------------------------------------- frames ------

    /// Describes a 4-frame transaction whose body calls `target` with `data` and `value`, and whose pre_verify frame
    /// charges `CLASS`; `nonceKey` is the transaction's single nonce key.
    function _frames(address target, uint256 value, bytes memory data, uint256 nonceKey) internal {
        mockTxParam(address(acc), TX_FRAME_COUNT, 4);
        mockFrameParam(address(acc), 3, FP_RESOLVED_TARGET, uint256(uint160(target)));
        mockFrameParam(address(acc), 3, FP_VALUE, value);
        mockFrameParam(address(acc), 3, FP_DATA_LENGTH, data.length);
        mockFrameDataCopy(address(acc), 0, data.length, 3, data);
        mockFrameDataWord(address(acc), 0, 1, CLASS);
        mockTxParam(address(acc), TX_NONCE_KEY_COUNT, 1);
        mockTxParam(address(acc), TX_NONCE_KEY_0, nonceKey);
    }

    function _transfer(uint256 amount) internal view returns (bytes memory) {
        return abi.encodeWithSelector(TRANSFER, supplier, amount);
    }

    function _verifyZk(SharedAccount.ZkAuth memory a) internal returns (bool ok) {
        (ok,) = address(acc).call(abi.encode(acc.MODE_ZK(), abi.encode(a)));
    }

    function _verifyKey() internal returns (bool ok) {
        (ok,) = address(acc).call(abi.encode(acc.MODE_KEY(), abi.encode(SharedAccount.KeyAuth({policy: policy}))));
    }

    // -------------------------------------------------------------------------------------------- zk tests ------

    function test_zk_validProofApprovesExecution() public {
        bytes memory data = _transfer(5e6);
        uint256 message = acc.computeMessage(CLASS, usdc, 0, data);
        SharedAccount.ZkAuth memory a = _prove(aliceSecret, message, 2); // two registrations = epoch 2
        assertEq(a.merkleTreeRoot, ks.root(CLASS), "prover and Keystore disagree on the root");
        _frames(usdc, 0, data, a.nullifier);

        vm.expectEmit(address(acc));
        emit Approved(2); // Scope.EXECUTION
        assertTrue(_verifyZk(a));
    }

    function test_zk_rejectsAmountOverCap() public {
        bytes memory data = _transfer(11e6);
        SharedAccount.ZkAuth memory a = _prove(aliceSecret, acc.computeMessage(CLASS, usdc, 0, data), 2);
        _frames(usdc, 0, data, a.nullifier);
        assertFalse(_verifyZk(a));
    }

    function test_zk_rejectsOtherTarget() public {
        bytes memory data = _transfer(5e6);
        SharedAccount.ZkAuth memory a = _prove(aliceSecret, acc.computeMessage(CLASS, usdc, 0, data), 2);
        _frames(address(0xDEAD), 0, data, a.nullifier);
        assertFalse(_verifyZk(a));
    }

    function test_zk_rejectsProofBoundToAnotherAction() public {
        bytes memory proven = _transfer(5e6);
        bytes memory actual = _transfer(3e6); // still within policy, but not what was proven
        SharedAccount.ZkAuth memory a = _prove(aliceSecret, acc.computeMessage(CLASS, usdc, 0, proven), 2);
        _frames(usdc, 0, actual, a.nullifier);
        assertFalse(_verifyZk(a));
    }

    function test_zk_rejectsNonceKeyThatIsNotTheNullifier() public {
        bytes memory data = _transfer(5e6);
        SharedAccount.ZkAuth memory a = _prove(aliceSecret, acc.computeMessage(CLASS, usdc, 0, data), 2);
        _frames(usdc, 0, data, a.nullifier + 1);
        assertFalse(_verifyZk(a));
    }

    function test_zk_rejectsWrongScope() public {
        bytes memory data = _transfer(5e6);
        SharedAccount.ZkAuth memory a = _prove(aliceSecret, acc.computeMessage(CLASS, usdc, 0, data), 3); // root is epoch 2
        _frames(usdc, 0, data, a.nullifier);
        assertFalse(_verifyZk(a));
    }

    function test_zk_rejectsWrongPaymasterClass() public {
        bytes memory data = _transfer(5e6);
        SharedAccount.ZkAuth memory a = _prove(aliceSecret, acc.computeMessage(CLASS, usdc, 0, data), 2);
        _frames(usdc, 0, data, a.nullifier);
        mockFrameDataWord(address(acc), 0, 1, keccak256("some other class"));
        assertFalse(_verifyZk(a));
    }

    function test_zk_revocationInvalidatesOldRootButBobStillWorks() public {
        bytes memory data = _transfer(5e6);
        uint256 message = acc.computeMessage(CLASS, usdc, 0, data);
        SharedAccount.ZkAuth memory aliceProof = _prove(aliceSecret, message, 2);

        // revoke alice: generation 1, root seq 3
        ks.revoke(CLASS, aliceC, _siblings(aliceSecret));
        members[0] = 0;
        assertEq(ks.generation(CLASS), 1);

        _frames(usdc, 0, data, aliceProof.nullifier);
        assertFalse(_verifyZk(aliceProof)); // old generation

        SharedAccount.ZkAuth memory bobProof = _prove(bobSecret, message, 3);
        assertEq(bobProof.merkleTreeRoot, ks.root(CLASS), "prover and Keystore disagree after a removal");
        _frames(usdc, 0, data, bobProof.nullifier);
        vm.expectEmit(address(acc));
        emit Approved(2);
        assertTrue(_verifyZk(bobProof));
    }

    function test_zk_heartbeatGivesANewEpochWithANewNullifier() public {
        bytes memory data = _transfer(5e6);
        uint256 message = acc.computeMessage(CLASS, usdc, 0, data);
        SharedAccount.ZkAuth memory first = _prove(aliceSecret, message, 2);

        vm.roll(block.number + 5);
        ks.heartbeat(CLASS); // same root, epoch 3
        SharedAccount.ZkAuth memory second = _prove(aliceSecret, message, 3);
        assertTrue(first.nullifier != second.nullifier);

        _frames(usdc, 0, data, first.nullifier);
        assertFalse(_verifyZk(first)); // epoch 2 is no longer the root's epoch
        _frames(usdc, 0, data, second.nullifier);
        assertTrue(_verifyZk(second));
    }

    // ------------------------------------------------------------------------------------------- key tests ------

    function test_key_registeredOneTimeKeyApprovesExecution() public {
        bytes memory data = _transfer(5e6);
        mockSigner(address(acc), oneTime1);
        _frames(usdc, 0, data, uint256(uint160(oneTime1)));
        vm.expectEmit(address(acc));
        emit Approved(2);
        assertTrue(_verifyKey());
    }

    function test_key_rejectsUnregisteredSigner() public {
        bytes memory data = _transfer(5e6);
        mockSigner(address(acc), address(0xBAD));
        _frames(usdc, 0, data, uint256(uint160(address(0xBAD))));
        assertFalse(_verifyKey());
    }

    function test_key_rejectsNonceKeyThatIsNotTheSigner() public {
        bytes memory data = _transfer(5e6);
        mockSigner(address(acc), oneTime1);
        _frames(usdc, 0, data, uint256(uint160(oneTime2)));
        assertFalse(_verifyKey());
    }

    function test_key_rejectsPolicyViolation() public {
        bytes memory data = _transfer(11e6);
        mockSigner(address(acc), oneTime1);
        _frames(usdc, 0, data, uint256(uint160(oneTime1)));
        assertFalse(_verifyKey());
    }

    function test_key_revokedKeyIsRejected() public {
        bytes memory data = _transfer(5e6);
        // siblings for the leaf uint256(oneTime1): compute from the full member list via the prover's group
        string[] memory t = new string[](3);
        t[0] = "siblings-of-leaf";
        t[1] = vm.toString(uint256(uint160(oneTime1)));
        t[2] = _membersJson();
        uint256[] memory siblings = vm.parseJsonUintArray(_tsx(t), ".siblings");
        ks.revoke(CLASS, uint256(uint160(oneTime1)), siblings);
        assertFalse(ks.isMember(CLASS, uint256(uint160(oneTime1))));

        mockSigner(address(acc), oneTime1);
        _frames(usdc, 0, data, uint256(uint160(oneTime1)));
        assertFalse(_verifyKey());

        mockSigner(address(acc), oneTime2);
        _frames(usdc, 0, data, uint256(uint160(oneTime2)));
        assertTrue(_verifyKey());
    }

    // ----------------------------------------------------------------------------------------------- admin ------

    function test_adminPathApprovesBothScopesForAdminOnly() public {
        mockSigner(address(acc), address(this)); // the test contract deployed the account
        vm.expectEmit(address(acc));
        emit Approved(3);
        (bool ok,) = address(acc).call(hex"01");
        assertTrue(ok);

        mockSigner(address(acc), address(0xBAD));
        (ok,) = address(acc).call(hex"01");
        assertFalse(ok);
    }

    function test_unknownModeReverts() public {
        (bool ok,) = address(acc).call(abi.encode(uint256(9), bytes("")));
        assertFalse(ok);
    }
}
