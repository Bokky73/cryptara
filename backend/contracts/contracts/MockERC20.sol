// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MCK") {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }
}

/// @notice ERC-20 that burns a fee on every transfer, so recipients receive
///         less than the amount sent. Used to verify vault balance accounting.
contract MockFeeOnTransferERC20 is ERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 _feeBps) ERC20("Fee Token", "FEE") {
        require(_feeBps <= 10_000, "fee too high");
        feeBps = _feeBps;
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        uint256 net = value - fee;
        super._update(from, to, net);
        if (fee > 0) {
            super._update(from, address(0), fee);
        }
    }
}

/// @notice ERC-20 that invokes a configurable hook on the recipient during
///         transfers, enabling reentrancy tests against the vault.
contract MockReentrantERC20 is ERC20 {
    address public hookTarget;
    bytes public hookData;
    bool public hookEnabled;

    constructor() ERC20("Reentrant Token", "REENT") {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    function setHook(address target, bytes calldata data) external {
        hookTarget = target;
        hookData = data;
        hookEnabled = true;
    }

    function disableHook() external {
        hookEnabled = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hookEnabled && to != address(0) && to == hookTarget) {
            (bool ok, ) = to.call(hookData);
            require(ok, "hook failed");
        }
    }
}
