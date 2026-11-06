// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InternalLeanIMT, LeanIMTData} from "lean-imt/InternalLeanIMT.sol";

/// AnonAI Keystore: one Semaphore group (Poseidon LeanIMT of identity commitments) per policy class.
///
/// Owners register their agents' identity commitments under a policy class and revoke them later. Every change
/// commits the class's Merkle root twice: to this contract's own bookkeeping (which the SharedAccount reads during
/// validation, see docs/SPEC.md D4) and to the EIP-8272 recent-root predeploy (which the transaction declares, so
/// the mempool can evict stale transactions). `heartbeat` re-commits an unchanged root: each committed root is one
/// epoch, and an agent gets one action per epoch (its nullifier is derived from the root's sequence number).
///
/// Revocation bumps the class generation. The SharedAccount only accepts roots of the current generation, so a
/// revocation invalidates every older root at once, while routine registrations leave older roots usable.
///
/// Ordinary transactions only: nothing here runs inside a frame transaction's validation.
contract Keystore {
    using InternalLeanIMT for LeanIMTData;

    address public constant RECENT_ROOT_ADDRESS = 0x0000000000000000000000000000000000008272;

    struct RootInfo {
        uint64 seq; // 1-based commit sequence number within the class; 0 = never committed
        uint32 generation; // class generation when this root was committed
    }

    struct Class {
        LeanIMTData tree;
        uint256[] members; // leaves in insertion order; a revoked leaf becomes 0 and keeps its index
        uint32 generation;
        uint64 rootSeq;
        uint64 lastCommitBlock;
        mapping(uint256 => RootInfo) roots;
        mapping(uint256 => address) registrant; // commitment => who registered it (may revoke it)
    }

    /// Minimum blocks between heartbeats of one class (registrations and revocations always commit).
    uint256 public immutable epochBlocks;

    mapping(bytes32 => Class) private classes;

    event MemberAdded(bytes32 indexed policyClass, uint256 index, uint256 commitment);
    event MemberRemoved(bytes32 indexed policyClass, uint256 index, uint256 commitment, uint32 newGeneration);
    event RootCommitted(bytes32 indexed policyClass, uint64 seq, uint32 generation, uint256 root);

    error AlreadyRegistered(uint256 commitment);
    error NotRegistrant(uint256 commitment);
    error HeartbeatTooSoon(uint256 earliestBlock);
    error RecentRootCommitFailed();

    constructor(uint256 epochBlocks_) {
        epochBlocks = epochBlocks_;
    }

    // ------------------------------------------------------------------------------------------- owner side ----

    /// Registers identity commitments under a policy class and commits the new root.
    function register(bytes32 policyClass, uint256[] calldata commitments) external {
        Class storage c = classes[policyClass];
        for (uint256 i = 0; i < commitments.length; i++) {
            uint256 commitment = commitments[i];
            if (c.registrant[commitment] != address(0)) revert AlreadyRegistered(commitment);
            c.registrant[commitment] = msg.sender;
            c.tree._insert(commitment);
            c.members.push(commitment);
            emit MemberAdded(policyClass, c.members.length - 1, commitment);
        }
        _commit(policyClass);
    }

    /// Removes a commitment (the LeanIMT sets the leaf to 0), bumps the generation and commits the new root.
    /// `siblings` are the Merkle siblings of the leaf, computed off chain from `members`.
    function revoke(bytes32 policyClass, uint256 commitment, uint256[] calldata siblings) external {
        Class storage c = classes[policyClass];
        if (c.registrant[commitment] != msg.sender) revert NotRegistrant(commitment);
        uint256 index = c.tree._indexOf(commitment);
        c.tree._remove(commitment, siblings);
        c.members[index] = 0;
        c.registrant[commitment] = address(0);
        c.generation += 1;
        emit MemberRemoved(policyClass, index, commitment, c.generation);
        _commit(policyClass);
    }

    /// Re-commits the current root as a new epoch. Anyone may call it, at most once per `epochBlocks`.
    function heartbeat(bytes32 policyClass) external {
        Class storage c = classes[policyClass];
        uint256 earliest = uint256(c.lastCommitBlock) + epochBlocks;
        if (block.number < earliest) revert HeartbeatTooSoon(earliest);
        _commit(policyClass);
    }

    function _commit(bytes32 policyClass) internal {
        Class storage c = classes[policyClass];
        uint256 root = c.tree._root();
        c.rootSeq += 1;
        c.roots[root] = RootInfo({seq: c.rootSeq, generation: c.generation});
        c.lastCommitBlock = uint64(block.number);
        // EIP-8272: the predeploy takes exactly salt || root and records it under keccak256(this || salt).
        (bool ok,) = RECENT_ROOT_ADDRESS.call(abi.encodePacked(policyClass, bytes32(root)));
        if (!ok) revert RecentRootCommitFailed();
        emit RootCommitted(policyClass, c.rootSeq, c.generation, root);
    }

    // ------------------------------------------------------------------------------------------------ views ----

    /// What the SharedAccount checks in its VERIFY frame: the root's commit sequence and generation.
    function rootInfo(bytes32 policyClass, uint256 root) external view returns (uint64 seq, uint32 generation) {
        RootInfo storage r = classes[policyClass].roots[root];
        return (r.seq, r.generation);
    }

    function generation(bytes32 policyClass) external view returns (uint32) {
        return classes[policyClass].generation;
    }

    function rootSeq(bytes32 policyClass) external view returns (uint64) {
        return classes[policyClass].rootSeq;
    }

    function root(bytes32 policyClass) external view returns (uint256) {
        return classes[policyClass].tree._root();
    }

    function size(bytes32 policyClass) external view returns (uint256) {
        return classes[policyClass].tree.size;
    }

    function depth(bytes32 policyClass) external view returns (uint256) {
        return classes[policyClass].tree.depth;
    }

    /// All leaves in insertion order (revoked ones are 0). The prover rebuilds the group from this.
    function members(bytes32 policyClass) external view returns (uint256[] memory) {
        return classes[policyClass].members;
    }

    function registrantOf(bytes32 policyClass, uint256 commitment) external view returns (address) {
        return classes[policyClass].registrant[commitment];
    }

    /// Direct set membership (used by the SharedAccount's key mode): registered and not revoked.
    function isMember(bytes32 policyClass, uint256 leaf) external view returns (bool) {
        return classes[policyClass].registrant[leaf] != address(0);
    }

    function lastCommitBlock(bytes32 policyClass) external view returns (uint64) {
        return classes[policyClass].lastCommitBlock;
    }

    /// The EIP-8272 source id of a class's roots: keccak256(this || salt) with salt = policyClass.
    function sourceId(bytes32 policyClass) external view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), policyClass));
    }
}
