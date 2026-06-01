// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TokenFaucet is ERC20, ERC20Burnable, Ownable {
    uint256 public claimAmount = 100 * 10 ** 18;
    uint256 public cooldown    = 24 hours;

    mapping(address => uint256) public lastClaimed;

    event Claimed(address indexed user, uint256 amount, uint256 timestamp);

    constructor() ERC20("DevToken", "DEV") Ownable(msg.sender) {
        _mint(address(this), 1_000_000 * 10 ** 18);
    }

    function claim() external {
        require(block.timestamp >= lastClaimed[msg.sender] + cooldown, "Faucet: cooldown active");
        require(balanceOf(address(this)) >= claimAmount, "Faucet: depleted");
        lastClaimed[msg.sender] = block.timestamp;
        _transfer(address(this), msg.sender, claimAmount);
        emit Claimed(msg.sender, claimAmount, block.timestamp);
    }

    function timeUntilNextClaim(address user) external view returns (uint256) {
        if (block.timestamp >= lastClaimed[user] + cooldown) return 0;
        return (lastClaimed[user] + cooldown) - block.timestamp;
    }

    function refill(uint256 amount) external onlyOwner { _mint(address(this), amount); }
    function setClaimAmount(uint256 amount) external onlyOwner { claimAmount = amount; }
    function setCooldown(uint256 seconds_) external onlyOwner { cooldown = seconds_; }
}
