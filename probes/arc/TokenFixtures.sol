// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// Synthetic failure modes ONLY for localhost; never an Arc system-contract substitute.
contract TokenFixture {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public mode;
    constructor() { require(block.chainid == 31337, "LOCAL_ONLY"); balanceOf[msg.sender] = 1000000; }
    function setMode(uint8 value) external { mode = value; }
    function approve(address spender, uint256 value) external returns (bool) { allowance[msg.sender][spender] = value; return true; }
    function transfer(address to, uint256 amount) external returns (bool) { return move(msg.sender, to, amount); }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        return move(from, to, amount);
    }
    function move(address from, address to, uint256 amount) internal returns (bool) {
        if (mode == 1) return false;
        require(mode != 2, "BLOCKLIST_MODEL_ONLY");
        require(balanceOf[from] >= amount, "BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += mode == 4 && amount > 0 ? amount - 1 : amount;
        if (mode == 3) { assembly ("memory-safe") { return(0, 0) } }
        return true;
    }
}
