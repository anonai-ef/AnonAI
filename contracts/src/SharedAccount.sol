// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HegotaSupport} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {Devnet} from "@forshtat/hegota-support/contracts/Devnet.sol";
import {FrameParam, Scope, SigParam, TxParam} from "@forshtat/hegota-support/contracts/Params.sol";

interface IKeystore {
    function rootInfo(bytes32 policyClass, uint256 root) external view returns (uint64 seq, uint32 generation);
    function generation(bytes32 policyClass) external view returns (uint32);
    function isMember(bytes32 policyClass, uint256 leaf) external view returns (bool);
}

interface ISemaphoreVerifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals,
        uint256 merkleTreeDepth
    ) external view returns (bool);
}

/// AnonAI shared account: the one EIP-8141 sender every agent of every owner acts from.
///
/// Its `only_verify` frame (frame 0) authorises a transaction in one of two modes, chosen per transaction:
///
///   MODE_ZK  - a Semaphore v4 Groth16 membership proof (signature entry: scheme 0, ARBITRARY). Hides which member
///              acted. Nullifier = the transaction's single EIP-8250 nonce key, so each (agent, epoch) acts once.
///              ~300k validation gas; needs the bn254 precompiles to be admitted by the mempool node.
///   MODE_KEY - a fresh one-time secp256k1 key per action (signature entry: scheme 1, SECP256K1, verified by the
///              protocol). The signer address must be a member leaf of the policy class in the Keystore. The address
///              is the nonce key, so each key acts once. ~60k validation gas; reveals the one-time key (and so the
///              registration that added it), hides nothing more than that. The fallback when ZK cannot be admitted.
///
/// Both modes then check the action against the policy the proof or key was registered under, and approve execution.
///
/// Transaction layout (docs/SPEC.md section 5):
///   0 only_verify  -> this contract, data = abi.encode(uint256 mode, bytes auth)
///   1 pre_verify   -> paymaster, data = policyClass
///   2 pay          -> paymaster
///   3 body         -> policy.target, run as this contract
///
/// Reads during validation: the Keystore and the verifier (non-entity contracts, read-only) - allowed for a staked
/// sender (STORAGE-032). No environment opcodes are used.
contract SharedAccount is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    struct Policy {
        address target; // the one contract the agent may call
        bytes4 selector; // required selector, or 0 for any
        uint256 maxValue; // max ETH value of the body frame
        uint256 maxAmount; // cap on the calldata word at offset 36 (the amount of transfer(address,uint256)); max = no cap
    }

    struct ZkAuth {
        Policy policy;
        uint256 merkleTreeDepth;
        uint256 merkleTreeRoot;
        uint256 nullifier;
        uint256 scope; // the Keystore's commit sequence number of merkleTreeRoot
        uint256[8] points;
    }

    struct KeyAuth {
        Policy policy;
    }

    uint256 public constant MODE_ZK = 1;
    uint256 public constant MODE_KEY = 2;

    IKeystore public immutable keystore;
    ISemaphoreVerifier public immutable verifier;
    address public immutable admin;
    uint256 public immutable chainId;

    bytes32 public constant ACTION_DOMAIN = keccak256("AnonAI.action.v1");
    uint256 public constant FRAME_COUNT = 4;
    uint256 public constant PRE_VERIFY_FRAME = 1;
    uint256 public constant BODY_FRAME = 3;

    constructor(address keystore_, address verifier_) payable {
        keystore = IKeystore(keystore_);
        verifier = ISemaphoreVerifier(verifier_);
        admin = msg.sender;
        chainId = block.chainid;
    }

    /// Frames land here; the frame's data is the calldata.
    fallback() external payable {
        if (msg.data.length == 1) {
            _admin();
            return;
        }
        (uint256 mode, bytes memory auth) = abi.decode(msg.data, (uint256, bytes));
        if (mode == MODE_ZK) _authorizeZk(abi.decode(auth, (ZkAuth)));
        else if (mode == MODE_KEY) _authorizeKey(abi.decode(auth, (KeyAuth)));
        else revert("AnonAI: unknown mode");
    }

    /// Admin self-relay (used once, to stake this account): the tx carries a SECP256K1 signature by the admin.
    function _admin() internal {
        require(address(uint160(sigparam(0, SigParam.RESOLVED_SIGNER))) == admin, "AnonAI: not admin");
        approve(Scope.EXECUTION_AND_PAYMENT);
    }

    // ---------------------------------------------------------------------------------------------- modes ------

    function _authorizeZk(ZkAuth memory a) internal {
        (bytes32 policyClass, address target, uint256 value, bytes memory data) = _checkAction(a.policy, a.nullifier);

        // The root is one the Keystore committed for this class, in the current generation, and the proof's scope
        // is that root's epoch (commit sequence number).
        (uint64 seq, uint32 gen) = keystore.rootInfo(policyClass, a.merkleTreeRoot);
        require(seq != 0, "AnonAI: unknown root");
        require(gen == keystore.generation(policyClass), "AnonAI: root from an old generation");
        require(a.scope == uint256(seq), "AnonAI: scope is not the root epoch");

        // The proof is bound to exactly this action.
        uint256 message = computeMessage(policyClass, target, value, data);
        require(
            verifier.verifyProof(
                [a.points[0], a.points[1]],
                [[a.points[2], a.points[3]], [a.points[4], a.points[5]]],
                [a.points[6], a.points[7]],
                [a.merkleTreeRoot, a.nullifier, _hash(message), _hash(a.scope)],
                a.merkleTreeDepth
            ),
            "AnonAI: invalid proof"
        );

        approve(Scope.EXECUTION);
    }

    function _authorizeKey(KeyAuth memory a) internal {
        // The protocol already verified the SECP256K1 signature entry; its resolved signer is the one-time key.
        uint256 signer = sigparam(0, SigParam.RESOLVED_SIGNER);
        require(signer != 0, "AnonAI: no signer");
        (bytes32 policyClass,,,) = _checkAction(a.policy, signer);
        require(keystore.isMember(policyClass, signer), "AnonAI: key is not a member");
        approve(Scope.EXECUTION);
    }

    // --------------------------------------------------------------------------------------- shared checks ------

    /// Checks the frame layout, the body frame against the policy, the paymaster's class and that `nonceKey` is the
    /// transaction's only nonce key. Returns what the body frame does, for the message binding.
    function _checkAction(Policy memory policy, uint256 nonceKey)
        internal
        view
        returns (bytes32 policyClass, address target, uint256 value, bytes memory data)
    {
        policyClass = keccak256(abi.encode(policy));

        require(txparam(TxParam.FRAME_COUNT) == FRAME_COUNT, "AnonAI: frame layout");
        target = address(uint160(frameparam(BODY_FRAME, FrameParam.RESOLVED_TARGET)));
        require(target == policy.target, "AnonAI: target not allowed");
        value = frameparam(BODY_FRAME, FrameParam.VALUE);
        require(value <= policy.maxValue, "AnonAI: value over cap");
        uint256 len = frameparam(BODY_FRAME, FrameParam.DATA_LENGTH);
        data = len == 0 ? new bytes(0) : framedatacopy(0, len, BODY_FRAME);
        if (policy.selector != bytes4(0)) {
            require(len >= 4 && bytes4(data) == policy.selector, "AnonAI: selector not allowed");
        }
        if (policy.maxAmount != type(uint256).max) {
            require(len >= 68, "AnonAI: no amount");
            uint256 amount;
            assembly ("memory-safe") {
                amount := mload(add(data, 68)) // 32 (length) + 36 (selector + first word)
            }
            require(amount <= policy.maxAmount, "AnonAI: amount over cap");
        }

        // The paymaster charges the same policy class (pre_verify frame data is the class).
        require(bytes32(framedataload(0, PRE_VERIFY_FRAME)) == policyClass, "AnonAI: paymaster class");

        // Single use, enforced by the protocol: the nullifier (ZK) or the one-time key (KEY) is the only nonce key.
        require(txparam(TxParam.NONCE_KEY_COUNT) == 1, "AnonAI: one nonce key");
        require(txparam(TxParam.NONCE_KEY_0) == nonceKey, "AnonAI: nonce key mismatch");
    }

    /// The Semaphore `message` an agent must prove for an action from this account. Public so the prover and the
    /// tests use the same formula.
    function computeMessage(bytes32 policyClass, address target, uint256 value, bytes memory data)
        public
        view
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(ACTION_DOMAIN, chainId, address(this), policyClass, target, value, keccak256(data)))) >> 8;
    }

    function policyClassOf(Policy memory policy) external pure returns (bytes32) {
        return keccak256(abi.encode(policy));
    }

    /// Semaphore v4's hash of a public input: keccak256 of the 32-byte value, shifted into the scalar field.
    function _hash(uint256 x) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(x))) >> 8;
    }
}
