// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface ProbeUsdc {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Test harness, NOT a Deliver/Group/Split contract or production escrow.
/// No pricing authority, delivery attestation, refund period, or dispute policy.
/// Deployment scripts allow only a loopback Arc development chain.
contract OrderEventsProbe {
    ProbeUsdc private constant USDC = ProbeUsdc(0x3600000000000000000000000000000000000000);
    address public immutable operator;
    address public immutable beneficiary;
    struct Item {
        address payer;
        bytes32 rulesHash;
        bytes32 nonce;
        uint256 amount;
        uint32 sequence;
        uint8 state;
        bool available;
    }
    mapping(bytes32 => Item) private items;
    mapping(bytes32 => bool) private usedNonces;
    event OrderTransition(bytes32 indexed orderId, address indexed payer, bytes32 indexed rulesHash,
        uint32 sequence, uint8 kind, uint256 amountU6, address recipient, bytes32 nonce);

    constructor(address recipient) {
        require(recipient != address(0), "RECIPIENT");
        operator = msg.sender;
        beneficiary = recipient;
    }
    function pay(bytes32 orderId, bytes32 rulesHash, bytes32 nonce, uint256 amountU6, uint64 expiresAt) external {
        require(items[orderId].payer == address(0) && !usedNonces[nonce], "DUPLICATE");
        require(block.timestamp < expiresAt && amountU6 > 0 && amountU6 <= 100_000_000, "INTENT");
        usedNonces[nonce] = true;
        items[orderId] = Item(msg.sender, rulesHash, nonce, amountU6, 1, 1, false);
        require(USDC.transferFrom(msg.sender, address(this), amountU6), "TRANSFER_FROM");
        emit OrderTransition(orderId, msg.sender, rulesHash, 1, 1, amountU6, address(this), nonce);
    }
    function advance(bytes32 orderId, uint8 kind) external {
        Item storage item = items[orderId];
        require(item.payer != address(0), "UNKNOWN");
        address recipient;
        uint256 amount = item.amount;
        if (kind == 2) {
            require(msg.sender == operator && item.state == 1 && !item.available, "AVAILABLE");
            item.available = true; recipient = item.payer; amount = 0;
        } else if (kind == 3 || kind == 4) {
            require(msg.sender == operator && item.state == 1, "CREDIT");
            item.state = kind; recipient = kind == 3 ? item.payer : beneficiary;
        } else if (kind == 5 || kind == 6) {
            require(item.state == kind - 2, "WITHDRAW");
            item.state = kind; recipient = kind == 5 ? item.payer : beneficiary;
            require(USDC.transfer(recipient, amount), "TRANSFER");
        } else revert("KIND");
        item.sequence += 1;
        emit OrderTransition(orderId, item.payer, item.rulesHash, item.sequence, kind, amount, recipient, item.nonce);
    }
}
