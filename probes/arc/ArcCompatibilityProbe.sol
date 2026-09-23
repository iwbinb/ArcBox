// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// Test-only. No product escrow, arbitrary recipient, administrator or mainnet mode.
contract ArcCompatibilityProbe is EIP712 {
    using SafeERC20 for IERC20;
    address public constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 public constant MAX_AMOUNT = 10000;
    bytes32 public constant TYPEHASH = keccak256("ProbeAction(bytes32 caseId,address signer,uint256 nonce,uint256 deadline)");
    address public immutable operator;
    IERC20 public immutable token;
    mapping(bytes32 => bool) public completed;
    mapping(address => uint256) public nonces;
    event ProbeRoundTrip(bytes32 indexed caseId, address indexed payer, uint256 amountU6);
    event SignatureConsumed(bytes32 indexed caseId, address indexed signer, uint256 nonce);
    error InvalidProbe();
    error ExpectedProbeFailure();
    modifier onlyOperator() { require(msg.sender == operator, "OPERATOR_ONLY"); _; }

    constructor(address asset) EIP712("ArcBoxCompatibilityProbe", "1") {
        require(block.chainid == 31337 || block.chainid == 5042002, "TEST_ONLY_CHAIN");
        require(block.chainid == 31337 || asset == ARC_USDC, "TESTNET_USDC_ONLY");
        require(IERC20Metadata(asset).decimals() == 6, "DECIMALS_MISMATCH");
        operator = msg.sender;
        token = IERC20(asset);
    }
    function roundTrip(bytes32 caseId, uint256 amountU6) external onlyOperator {
        require(caseId != bytes32(0) && !completed[caseId], "CASE_REPLAY");
        require(amountU6 > 0 && amountU6 <= MAX_AMOUNT, "AMOUNT_LIMIT");
        completed[caseId] = true;
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amountU6);
        require(token.balanceOf(address(this)) == beforeBalance + amountU6, "NON_EXACT_TOKEN");
        token.safeTransfer(msg.sender, amountU6);
        require(token.balanceOf(address(this)) == beforeBalance, "RESIDUAL_CHANGED");
        emit ProbeRoundTrip(caseId, msg.sender, amountU6);
    }
    function digest(bytes32 caseId, address signer, uint256 nonce, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(TYPEHASH, caseId, signer, nonce, deadline)));
    }
    function verify(bytes32 caseId, address signer, uint256 nonce, uint256 deadline, bytes calldata signature) public view returns (bool) {
        return SignatureChecker.isValidSignatureNow(signer, digest(caseId, signer, nonce, deadline), signature);
    }
    function consume(bytes32 caseId, address signer, uint256 nonce, uint256 deadline, bytes calldata signature) external onlyOperator {
        require(block.timestamp < deadline && nonce == nonces[signer], "EXPIRED_OR_REPLAY");
        require(verify(caseId, signer, nonce, deadline, signature), "BAD_SIGNATURE");
        nonces[signer] = nonce + 1;
        emit SignatureConsumed(caseId, signer, nonce);
    }
    function expectedFailure() external pure { revert ExpectedProbeFailure(); }
}

/// Deployed ERC-1271 test fixture, not a general-purpose wallet implementation.
contract Probe1271Wallet {
    using SafeERC20 for IERC20;
    address public immutable owner;
    IERC20 public immutable token;
    bool public enabled = true;
    constructor(address asset) {
        require(block.chainid == 31337 || block.chainid == 5042002, "TEST_ONLY_CHAIN");
        require(asset == 0x3600000000000000000000000000000000000000, "ARC_USDC_ONLY");
        owner = msg.sender; token = IERC20(asset);
    }
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        return enabled && err == ECDSA.RecoverError.NoError && recovered == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
    function setEnabled(bool value) external { require(msg.sender == owner, "OWNER_ONLY"); enabled = value; }
    function returnToken() external { require(msg.sender == owner, "OWNER_ONLY"); token.safeTransfer(owner, token.balanceOf(address(this))); }
}
