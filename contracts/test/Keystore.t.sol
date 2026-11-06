// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Keystore} from "../src/Keystore.sol";
import {InternalLeanIMT, LeanIMTData} from "lean-imt/InternalLeanIMT.sol";

/// Stand-in for the write-only EIP-8272 predeploy: records the last salt || root it was given.
contract RecentRootRecorder {
    bytes32 public lastSalt;
    bytes32 public lastRoot;
    address public lastCaller;
    uint256 public commits;

    fallback() external payable {
        require(msg.value == 0 && msg.data.length == 64, "predeploy: expects salt || root");
        lastCaller = msg.sender;
        lastSalt = bytes32(msg.data[0:32]);
        lastRoot = bytes32(msg.data[32:64]);
        commits += 1;
    }
}

/// A reference tree to compute the siblings `revoke` needs and to cross-check roots.
contract ReferenceTree {
    using InternalLeanIMT for LeanIMTData;

    LeanIMTData internal t;

    function insert(uint256 leaf) external returns (uint256) {
        return t._insert(leaf);
    }

    function remove(uint256 leaf, uint256[] calldata siblings) external returns (uint256) {
        return t._remove(leaf, siblings);
    }

    function root() external view returns (uint256) {
        return t._root();
    }
}

contract KeystoreTest is Test {
    uint256 constant EPOCH_BLOCKS = 5;
    bytes32 constant CLASS = keccak256("usdc-10");

    Keystore ks;
    RecentRootRecorder rec;

    address owner = address(0xA11CE);
    address stranger = address(0xBAD);
    uint256 alice = 1111;
    uint256 bob = 2222;

    function setUp() public {
        rec = new RecentRootRecorder();
        vm.etch(address(0x0000000000000000000000000000000000008272), address(rec).code);
        rec = RecentRootRecorder(payable(address(0x0000000000000000000000000000000000008272)));
        ks = new Keystore(EPOCH_BLOCKS);
        vm.roll(100);
    }

    function _two() internal returns (uint256[] memory c) {
        c = new uint256[](2);
        c[0] = alice;
        c[1] = bob;
    }

    function test_registerCommitsRootToBookkeepingAndPredeploy() public {
        vm.prank(owner);
        ks.register(CLASS, _two());

        assertEq(ks.size(CLASS), 2);
        assertEq(ks.members(CLASS).length, 2);
        uint256 r = ks.root(CLASS);
        assertTrue(r != 0);
        (uint64 seq, uint32 gen) = ks.rootInfo(CLASS, r);
        assertEq(seq, 1);
        assertEq(gen, 0);
        assertEq(ks.rootSeq(CLASS), 1);

        assertEq(rec.commits(), 1);
        assertEq(rec.lastCaller(), address(ks));
        assertEq(rec.lastSalt(), CLASS);
        assertEq(rec.lastRoot(), bytes32(r));
        assertEq(ks.sourceId(CLASS), keccak256(abi.encodePacked(address(ks), CLASS)));
    }

    function test_rootMatchesReferenceLeanIMT() public {
        ReferenceTree ref = new ReferenceTree();
        ref.insert(alice);
        ref.insert(bob);
        vm.prank(owner);
        ks.register(CLASS, _two());
        assertEq(ks.root(CLASS), ref.root());
    }

    function test_duplicateRegistrationReverts() public {
        vm.prank(owner);
        ks.register(CLASS, _two());
        uint256[] memory again = new uint256[](1);
        again[0] = alice;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Keystore.AlreadyRegistered.selector, alice));
        ks.register(CLASS, again);
    }

    function test_revokeBumpsGenerationAndKeepsOldRootInfo() public {
        vm.prank(owner);
        ks.register(CLASS, _two());
        uint256 oldRoot = ks.root(CLASS);

        // siblings of alice (index 0) in a 2-leaf tree: [bob]
        uint256[] memory siblings = new uint256[](1);
        siblings[0] = bob;

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Keystore.NotRegistrant.selector, alice));
        ks.revoke(CLASS, alice, siblings);

        vm.prank(owner);
        ks.revoke(CLASS, alice, siblings);

        assertEq(ks.generation(CLASS), 1);
        assertEq(ks.rootSeq(CLASS), 2);
        assertEq(ks.members(CLASS)[0], 0);
        assertEq(ks.members(CLASS)[1], bob);
        assertEq(ks.registrantOf(CLASS, alice), address(0));

        uint256 newRoot = ks.root(CLASS);
        assertTrue(newRoot != oldRoot);
        (uint64 seqNew, uint32 genNew) = ks.rootInfo(CLASS, newRoot);
        assertEq(seqNew, 2);
        assertEq(genNew, 1);
        (uint64 seqOld, uint32 genOld) = ks.rootInfo(CLASS, oldRoot);
        assertEq(seqOld, 1);
        assertEq(genOld, 0); // the account rejects it: generation 0 != current 1
        assertEq(rec.commits(), 2);
        assertEq(rec.lastRoot(), bytes32(newRoot));
    }

    function test_revokedRootMatchesReference() public {
        ReferenceTree ref = new ReferenceTree();
        ref.insert(alice);
        ref.insert(bob);
        uint256[] memory siblings = new uint256[](1);
        siblings[0] = bob;
        ref.remove(alice, siblings);

        vm.startPrank(owner);
        ks.register(CLASS, _two());
        ks.revoke(CLASS, alice, siblings);
        vm.stopPrank();
        assertEq(ks.root(CLASS), ref.root());
    }

    function test_heartbeatIsSpacedAndReusesRoot() public {
        vm.prank(owner);
        ks.register(CLASS, _two());
        uint256 r = ks.root(CLASS);

        vm.expectRevert(abi.encodeWithSelector(Keystore.HeartbeatTooSoon.selector, 100 + EPOCH_BLOCKS));
        ks.heartbeat(CLASS);

        vm.roll(100 + EPOCH_BLOCKS);
        ks.heartbeat(CLASS);
        assertEq(ks.rootSeq(CLASS), 2);
        (uint64 seq, uint32 gen) = ks.rootInfo(CLASS, r);
        assertEq(seq, 2); // the same root now belongs to epoch 2
        assertEq(gen, 0);
        assertEq(rec.commits(), 2);
    }

    function test_unknownRootHasNoInfo() public view {
        (uint64 seq, uint32 gen) = ks.rootInfo(CLASS, 12345);
        assertEq(seq, 0);
        assertEq(gen, 0);
    }
}
