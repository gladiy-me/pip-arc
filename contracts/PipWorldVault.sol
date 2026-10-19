// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPipWorldForVault {
    function withdrawEarnings(address account) external;
    function earnings(address account) external view returns (uint256);
    function feed(uint256 id, uint256 amount, string calldata note) external;
    function mealSizeOf(uint8 stage) external view returns (uint256);
    function minFeed() external view returns (uint256);
}

/// @title PipWorldVault — the piggy bank of all pips
/// @notice Receives 90% of the metabolism of every pip in PipWorld. There is no withdraw function.
///         USDC can leave only in one of two public ways:
///         1. LAUNCH: the owner proposes a *contract* (e.g. a liquidity pool / LP locker for a future token).
///            It is public for LAUNCH_DELAY (14 days) before it can be executed. After launch, all vault USDC
///            can only flow to that one target (`flush`, anyone can call).
///         2. FOOD BANK: if nothing launched before `deadline` (deploy + 365 days), anyone can ask the vault to
///            feed a living pip: one small meal per pip per day. Vault meals never count towards growth.
contract PipWorldVault {
    using SafeERC20 for IERC20;

    uint256 public constant LAUNCH_DELAY = 14 days;
    uint256 public constant LAUNCH_WINDOW = 365 days;
    uint256 public constant FOOD_BANK_COOLDOWN = 1 days;
    uint256 public constant FOOD_BANK_MEAL = 24_000; // 0.024 USDC = one mochi day

    address public immutable world;
    address public immutable usdc;
    address public immutable owner;
    uint256 public immutable deadline;

    address public pendingTarget;
    uint256 public pendingSince;
    address public launchTarget;
    bool public launchRenounced;
    mapping(uint256 => uint256) public lastFoodBankMeal;

    event LaunchProposed(address indexed target, uint256 executableAt);
    event LaunchCancelled(address indexed target);
    event Launched(address indexed target, uint256 amount);
    event Flushed(address indexed target, uint256 amount);
    event FoodBankMeal(uint256 indexed petId, uint256 amount);
    event LaunchRenounced();

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _world, address _usdc, address _owner) {
        require(_world != address(0) && _usdc != address(0) && _owner != address(0), "Zero address");
        world = _world;
        usdc = _usdc;
        owner = _owner;
        deadline = block.timestamp + LAUNCH_WINDOW;
    }

    function totalBalance() external view returns (uint256) {
        return IERC20(usdc).balanceOf(address(this)) + IPipWorldForVault(world).earnings(address(this));
    }

    function launched() external view returns (bool) {
        return launchTarget != address(0);
    }

    /// @notice Food bank opens after `deadline` if nothing launched, or immediately once the launch path is renounced.
    function inFoodBankMode() public view returns (bool) {
        return launchTarget == address(0) && (launchRenounced || block.timestamp >= deadline);
    }

    function pull() public {
        if (IPipWorldForVault(world).earnings(address(this)) > 0) {
            IPipWorldForVault(world).withdrawEarnings(address(this));
        }
    }

    function flush() external {
        address target = launchTarget;
        require(target != address(0), "Not launched");
        pull();
        uint256 amount = IERC20(usdc).balanceOf(address(this));
        if (amount > 0) {
            IERC20(usdc).safeTransfer(target, amount);
            emit Flushed(target, amount);
        }
    }

    /// @notice Food bank mode only: one small meal for a living pip, at most once per day per pip.
    function feedPet(uint256 petId) external {
        require(inFoodBankMode(), "Not in food bank mode");
        require(block.timestamp >= lastFoodBankMeal[petId] + FOOD_BANK_COOLDOWN, "Already fed today");
        lastFoodBankMeal[petId] = block.timestamp;
        pull();
        uint256 amount = FOOD_BANK_MEAL;
        uint256 bal = IERC20(usdc).balanceOf(address(this));
        if (amount > bal) amount = bal;
        require(amount >= IPipWorldForVault(world).minFeed(), "Vault is empty");
        IERC20(usdc).forceApprove(world, amount);
        IPipWorldForVault(world).feed(petId, amount, "from pip's vault");
        emit FoodBankMeal(petId, amount);
    }

    /// @notice TRUST NOTE: the target only has to be a contract. The 14-day delay makes every proposal public
    ///         in advance, but it does not stop a bad target. Call `renounceLaunch()` to remove this path forever.
    function proposeLaunch(address target) external onlyOwner {
        require(!launchRenounced, "Launch renounced");
        require(launchTarget == address(0), "Already launched");
        require(target != address(0) && target != owner && target.code.length > 0, "Target must be a contract");
        require(block.timestamp + LAUNCH_DELAY <= deadline, "Launch window closed");
        pendingTarget = target;
        pendingSince = block.timestamp;
        emit LaunchProposed(target, block.timestamp + LAUNCH_DELAY);
    }

    /// @notice One-way: nobody (owner included) can ever move the vault except as pip food.
    function renounceLaunch() external onlyOwner {
        require(launchTarget == address(0), "Already launched");
        launchRenounced = true;
        pendingTarget = address(0);
        pendingSince = 0;
        emit LaunchRenounced();
    }

    function cancelLaunch() external onlyOwner {
        address target = pendingTarget;
        require(target != address(0), "Nothing pending");
        pendingTarget = address(0);
        pendingSince = 0;
        emit LaunchCancelled(target);
    }

    function executeLaunch() external onlyOwner {
        address target = pendingTarget;
        require(target != address(0), "Nothing pending");
        require(!launchRenounced, "Launch renounced");
        require(block.timestamp >= pendingSince + LAUNCH_DELAY, "Timelock");
        require(block.timestamp < deadline, "Launch window closed");
        launchTarget = target;
        pendingTarget = address(0);
        pendingSince = 0;
        pull();
        uint256 amount = IERC20(usdc).balanceOf(address(this));
        if (amount > 0) IERC20(usdc).safeTransfer(target, amount);
        emit Launched(target, amount);
    }
}
