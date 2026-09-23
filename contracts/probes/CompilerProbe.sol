// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// @notice Compilation fixture. Never deploy as an ArcBox business contract.
contract CompilerProbe {
    function schemaVersion() external pure returns (uint256) {
        return 1;
    }
}
