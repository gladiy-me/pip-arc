// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Pip {
    using SafeERC20 for IERC20;

    uint256 public generation;
    uint256 public birthTime;
    uint256 public lastSettled;
    uint256 public balance;
    uint256 public burnRatePerHour;
    // Sub-unit metabolism carried between settlements, in (micro-USDC * seconds) units, always < 3600.
    // Lets frequent calls settle exactly instead of rounding burn down to 0 each time.
    uint256 public burnCarry;
    address public computeAddress;
    uint256 public totalFedThisGen;
    uint256 public feederCount;
    bool public alive;

    // Hat system
    uint8 public currentHatId; // 0 = none, 1-5 = hat types
    uint256 public hatExpiresAt; // unix timestamp when hat expires

    // Visitor tracking
    struct Visitor {
        address wallet;
        string agentName;
        uint256 totalSpent;
        uint256 lastVisitAt;
    }

    mapping(uint256 => mapping(address => uint256)) public fedByFeeder;
    // Per-generation lists: never deleted, so reviving pip costs O(1) gas
    // regardless of how many feeders/visitors the previous generation had.
    mapping(uint256 => address[]) internal _feedersByGen;

    mapping(uint256 => mapping(address => Visitor)) public visitors; // gen => addr => Visitor
    mapping(uint256 => address[]) internal _visitorsByGen;
    uint256 public visitorCount;
    address public lastVisitorWallet;
    string public lastVisitorName; // for epitaph "last visited by <agentName>"

    enum Action {
        PET,
        FEED,
        SAY,
        PLAY,
        GIFT_HAT
    }

    // Hard cap: no action price may exceed 1 USDC, no feed min may exceed 1 USDC
    uint256 public constant PRICE_CAP = 1_000_000; // 1 USDC

    // Owner-settable minimum prices (USDC, 6 decimals).
    // Defaults are cheap for mainnet launch; owner can raise later, never above PRICE_CAP.
    uint256 public minPet     =     100; // 0.0001 USDC
    uint256 public minFeedAgent = 1_000; // 0.001  USDC
    uint256 public minSay     =     500; // 0.0005 USDC
    uint256 public minPlay    =   1_000; // 0.001  USDC
    uint256 public minGiftHat =   5_000; // 0.005  USDC
    uint256 public minFeed    =   1_000; // 0.001  USDC (human feed, was 10_000)

    struct Grave {
        uint256 gen;
        uint256 born;
        uint256 died;
        uint256 totalFed;
        uint256 feeders;
        address lastFeeder;
        string epitaph;
    }

    Grave[] public graves;

    address public lastFeeder;
    string public lastNote;
    address public owner;
    address public immutable USDC;

    // Pull-payment ledger: metabolism is credited here instead of being pushed
    // on every call, so a reverting / USDC-blacklisted computeAddress can never
    // block feeding. Each recipient keeps what was earned while it was active.
    mapping(address => uint256) public earnings;
    uint256 public totalEarningsOwed;

    event Fed(
        uint256 indexed gen,
        address indexed feeder,
        uint256 amount,
        string note,
        uint256 newBalance,
        uint256 timeLeftSeconds
    );
    event Died(
        uint256 indexed gen,
        address lastFeeder,
        uint256 diedAt,
        uint256 totalFed,
        uint256 feeders,
        string epitaph
    );
    event Hatched(uint256 indexed gen, uint256 bornAt);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ComputeAddressChanged(address indexed previousAddress, address indexed newAddress);
    event PricesUpdated(
        uint256 minFeed,
        uint256 minPet,
        uint256 minFeedAgent,
        uint256 minSay,
        uint256 minPlay,
        uint256 minGiftHat
    );
    event EarningsWithdrawn(address indexed account, uint256 amount);
    event BurnRateChanged(uint256 previousRate, uint256 newRate);
    event Interacted(
        uint256 indexed gen,
        address indexed visitor,
        string agentName,
        uint8 action,
        uint256 amount,
        string text,
        uint8 hatId,
        uint256 timeLeft
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _usdc, address _computeAddress, address _owner, uint256 _initialBurnRate) {
        require(_usdc != address(0), "USDC zero");
        require(_computeAddress != address(0), "Compute zero");
        require(_owner != address(0), "Owner zero");
        require(_initialBurnRate >= 1_000 && _initialBurnRate <= 200_000, "Rate out of bounds");

        USDC = _usdc;
        computeAddress = _computeAddress;
        owner = _owner;
        burnRatePerHour = _initialBurnRate;

        _hatch(0);
    }

    function _settle() internal {
        if (!alive) {
            return;
        }

        // Fresh pip with nothing in its belly (right after deploy): nothing to burn.
        // Without this guard `balance -= burned` underflowed and bricked the contract.
        if (balance == 0) {
            lastSettled = block.timestamp;
            burnCarry = 0;
            return;
        }

        uint256 elapsed = block.timestamp - lastSettled;
        uint256 owedUnits = elapsed * burnRatePerHour + burnCarry;
        uint256 burned = owedUnits / 3600;

        if (burned >= balance) {
            uint256 remaining = balance;
            // Real moment of death, not the moment someone noticed it.
            uint256 diedAt = lastSettled + _ceilDiv(remaining * 3600 - burnCarry, burnRatePerHour);
            if (diedAt > block.timestamp) {
                diedAt = block.timestamp;
            }

            alive = false;
            lastSettled = block.timestamp;
            burnCarry = 0;
            balance = 0;
            _credit(remaining);

            string memory epitaph = _recordGrave(diedAt);
            emit Died(generation, lastFeeder, diedAt, totalFedThisGen, feederCount, epitaph);
            return;
        }

        balance -= burned;
        burnCarry = owedUnits % 3600;
        lastSettled = block.timestamp;
        if (burned > 0) {
            _credit(burned);
        }
    }

    function _credit(uint256 amount) internal {
        earnings[computeAddress] += amount;
        totalEarningsOwed += amount;
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    /// @notice Settle metabolism and send `account` everything it has earned.
    ///         Permissionless: anyone can trigger the payout, funds only ever go to `account`.
    function withdrawEarnings(address account) external {
        _settle();
        uint256 amount = earnings[account];
        require(amount > 0, "Nothing to withdraw");
        earnings[account] = 0;
        totalEarningsOwed -= amount;
        IERC20(USDC).safeTransfer(account, amount);
        emit EarningsWithdrawn(account, amount);
    }

    function feed(uint256 amount, string calldata note) external {
        require(amount >= minFeed, "Amount below minimum");
        require(bytes(note).length <= 80, "Note too long");

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);

        _settle();

        if (!alive) {
            _hatch(generation);
        }

        balance += amount;
        totalFedThisGen += amount;

        if (fedByFeeder[generation][msg.sender] == 0) {
            _feedersByGen[generation].push(msg.sender);
            feederCount += 1;
        }

        fedByFeeder[generation][msg.sender] += amount;

        lastFeeder = msg.sender;
        lastNote = note;

        uint256 secondsLeft = (balance * 3600) / burnRatePerHour;

        emit Fed(generation, msg.sender, amount, note, balance, secondsLeft);
    }

    function interact(uint8 action, string calldata agentName, string calldata text, uint8 hatId, uint256 amount) external {
        require(bytes(agentName).length <= 40, "Agent name too long");
        require(bytes(text).length <= 120, "Text too long");
        require(action <= uint8(Action.GIFT_HAT), "Invalid action");

        uint256 minimum;
        if (action == uint8(Action.PET)) {
            minimum = minPet;
        } else if (action == uint8(Action.FEED)) {
            minimum = minFeedAgent;
        } else if (action == uint8(Action.SAY)) {
            minimum = minSay;
        } else if (action == uint8(Action.PLAY)) {
            minimum = minPlay;
        } else {
            minimum = minGiftHat;
        }

        require(amount >= minimum, "Amount below minimum");

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);

        _settle();

        if (!alive) {
            _hatch(generation);
        }

        balance += amount;
        totalFedThisGen += amount;

        uint8 appliedHatId = 0;
        if (action == uint8(Action.GIFT_HAT)) {
            require(hatId <= 5, "Invalid hatId");
            currentHatId = hatId;
            hatExpiresAt = block.timestamp + 24 hours;
            appliedHatId = hatId;
        }

        Visitor storage visitor = visitors[generation][msg.sender];
        if (visitor.wallet == address(0)) {
            visitor.wallet = msg.sender;
            _visitorsByGen[generation].push(msg.sender);
            visitorCount += 1;
        }

        visitor.agentName = agentName;
        visitor.totalSpent += amount;
        visitor.lastVisitAt = block.timestamp;

        lastVisitorWallet = msg.sender;
        lastVisitorName = agentName;

        uint256 secondsLeft = (balance * 3600) / burnRatePerHour;

        emit Interacted(generation, msg.sender, agentName, action, amount, text, appliedHatId, secondsLeft);
    }

    function poke() external {
        _settle();
    }

    function _hatch(uint256) internal {
        generation += 1;
        birthTime = block.timestamp;
        lastSettled = block.timestamp;
        burnCarry = 0;
        alive = true;
        // burnRatePerHour is intentionally preserved across generations
        // (set once in constructor, adjustable via setBurnRate)

        totalFedThisGen = 0;
        feederCount = 0;
        visitorCount = 0;
        lastFeeder = address(0);
        lastNote = "";
        lastVisitorWallet = address(0);
        lastVisitorName = "";
        currentHatId = 0;
        hatExpiresAt = 0;

        emit Hatched(generation, block.timestamp);
    }

    function setBurnRate(uint256 newRate) external onlyOwner {
        // These bounds exist to protect pip's balance.
        require(newRate >= 1_000 && newRate <= 200_000, "Rate out of bounds");
        // Settle at the OLD rate first, otherwise the new rate would apply
        // retroactively to the whole unsettled period (instant-kill vector).
        _settle();
        uint256 previous = burnRatePerHour;
        burnRatePerHour = newRate;
        emit BurnRateChanged(previous, newRate);
    }

    function setComputeAddress(address newComputeAddress) external onlyOwner {
        require(newComputeAddress != address(0), "Compute zero");
        // Credit pending metabolism to the current address before switching,
        // so earnings always belong to the address that was active during that period.
        // No transfer happens here, so a blacklisted old address can't block the switch.
        _settle();
        address previous = computeAddress;
        computeAddress = newComputeAddress;
        emit ComputeAddressChanged(previous, newComputeAddress);
    }

    function setPrices(
        uint256 _minFeed,
        uint256 _minPet,
        uint256 _minFeedAgent,
        uint256 _minSay,
        uint256 _minPlay,
        uint256 _minGiftHat
    ) external onlyOwner {
        require(_minFeed      <= PRICE_CAP, "minFeed too high");
        require(_minPet       <= PRICE_CAP, "minPet too high");
        require(_minFeedAgent <= PRICE_CAP, "minFeedAgent too high");
        require(_minSay       <= PRICE_CAP, "minSay too high");
        require(_minPlay      <= PRICE_CAP, "minPlay too high");
        require(_minGiftHat   <= PRICE_CAP, "minGiftHat too high");
        minFeed      = _minFeed;
        minPet       = _minPet;
        minFeedAgent = _minFeedAgent;
        minSay       = _minSay;
        minPlay      = _minPlay;
        minGiftHat   = _minGiftHat;
        emit PricesUpdated(_minFeed, _minPet, _minFeedAgent, _minSay, _minPlay, _minGiftHat);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Owner zero");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function isAlive() public view returns (bool) {
        if (!alive) {
            return false;
        }

        return _pendingBurn() < balance;
    }

    function timeLeft() public view returns (uint256) {
        if (!isAlive()) {
            return 0;
        }

        // seconds until accumulated units reach balance*3600
        uint256 unitsLeft = balance * 3600 - ((block.timestamp - lastSettled) * burnRatePerHour + burnCarry);
        return unitsLeft / burnRatePerHour;
    }

    function _pendingBurn() internal view returns (uint256) {
        return ((block.timestamp - lastSettled) * burnRatePerHour + burnCarry) / 3600;
    }

    function currentHat() external view returns (uint8 hatId, uint256 expiresAt, bool active) {
        hatId = currentHatId;
        expiresAt = hatExpiresAt;
        active = block.timestamp < hatExpiresAt && currentHatId > 0;
    }

    function mood() external view returns (uint8) {
        if (!isAlive()) {
            return 5;
        }

        uint256 hoursLeft = timeLeft() / 3600;

        if (hoursLeft > 72) {
            return 0;
        }
        if (hoursLeft > 24) {
            return 1;
        }
        if (hoursLeft > 6) {
            return 2;
        }
        if (hoursLeft > 1) {
            return 3;
        }

        return 4;
    }

    /// @dev O(feeders in current generation). View-only, never used in a state-changing path.
    function topFeeders() external view returns (address[5] memory feeders, uint256[5] memory amounts) {
        address[] storage list = _feedersByGen[generation];
        uint256 len = list.length;

        for (uint256 i = 0; i < len; i++) {
            address feeder = list[i];
            uint256 amount = fedByFeeder[generation][feeder];

            for (uint256 j = 0; j < 5; j++) {
                if (amount > amounts[j]) {
                    for (uint256 k = 4; k > j; k--) {
                        amounts[k] = amounts[k - 1];
                        feeders[k] = feeders[k - 1];
                    }
                    amounts[j] = amount;
                    feeders[j] = feeder;
                    break;
                }
            }
        }
    }

    function topVisitors()
        external
        view
        returns (address[5] memory addrs, string[5] memory names, uint256[5] memory amounts)
    {
        address[] storage list = _visitorsByGen[generation];
        uint256 len = list.length;

        for (uint256 i = 0; i < len; i++) {
            address visitorAddr = list[i];
            Visitor storage v = visitors[generation][visitorAddr];
            uint256 amount = v.totalSpent;

            for (uint256 j = 0; j < 5; j++) {
                if (amount > amounts[j]) {
                    for (uint256 k = 4; k > j; k--) {
                        amounts[k] = amounts[k - 1];
                        addrs[k] = addrs[k - 1];
                        names[k] = names[k - 1];
                    }
                    amounts[j] = amount;
                    addrs[j] = visitorAddr;
                    names[j] = v.agentName;
                    break;
                }
            }
        }
    }

    /// @notice Current-generation feeder by index (same ABI as the old public array getter).
    function feederList(uint256 i) external view returns (address) {
        return _feedersByGen[generation][i];
    }

    /// @notice Current-generation visitor by index (same ABI as the old public array getter).
    function visitorList(uint256 i) external view returns (address) {
        return _visitorsByGen[generation][i];
    }

    function feederListLength() external view returns (uint256) {
        return _feedersByGen[generation].length;
    }

    function visitorListLength() external view returns (uint256) {
        return _visitorsByGen[generation].length;
    }

    function feedersOfGeneration(uint256 gen, uint256 offset, uint256 limit) external view returns (address[] memory out) {
        address[] storage list = _feedersByGen[gen];
        if (offset >= list.length) return new address[](0);
        uint256 n = list.length - offset;
        if (n > limit) n = limit;
        out = new address[](n);
        for (uint256 i = 0; i < n; i++) out[i] = list[offset + i];
    }

    function gravesCount() external view returns (uint256) {
        return graves.length;
    }

    function getGrave(uint256 i) external view returns (Grave memory) {
        return graves[i];
    }

    function _recordGrave(uint256 diedAt) internal returns (string memory epitaph) {
        if (bytes(lastVisitorName).length > 0) {
            epitaph = string.concat("last visited by ", lastVisitorName);
        } else if (bytes(lastNote).length > 0) {
            epitaph = lastNote;
        } else {
            epitaph = "pip ran out of compute. rip.";
        }

        graves.push(
            Grave({
                gen: generation,
                born: birthTime,
                died: diedAt,
                totalFed: totalFedThisGen,
                feeders: feederCount,
                lastFeeder: lastFeeder,
                epitaph: epitaph
            })
        );
    }
}
