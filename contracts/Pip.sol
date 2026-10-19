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
    address public immutable computeAddress;
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
    address[] public feederList;

    mapping(uint256 => mapping(address => Visitor)) public visitors; // gen => addr => Visitor
    address[] public visitorList; // generation-scoped, reset on hatch
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

    // Minimum prices in USDC micros (6 decimals)
    uint256 public constant MIN_PET = 1_000; // 0.001 USDC
    uint256 public constant MIN_FEED_AGENT = 10_000; // 0.01 USDC (same as existing feed)
    uint256 public constant MIN_SAY = 5_000; // 0.005 USDC
    uint256 public constant MIN_PLAY = 20_000; // 0.02 USDC
    uint256 public constant MIN_GIFT_HAT = 50_000; // 0.05 USDC

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

    constructor(address _usdc, address _computeAddress, address _owner) {
        require(_usdc != address(0), "USDC zero");
        require(_computeAddress != address(0), "Compute zero");
        require(_owner != address(0), "Owner zero");

        USDC = _usdc;
        computeAddress = _computeAddress;
        owner = _owner;

        _hatch(0);
    }

    function _settle() internal {
        if (!alive) {
            return;
        }

        uint256 elapsed = block.timestamp - lastSettled;
        uint256 burned = (elapsed * burnRatePerHour) / 3600;

        if (balance > 0 && burned >= balance) {
            uint256 remaining = balance;
            alive = false;
            lastSettled = block.timestamp;
            balance = 0;

            if (remaining > 0) {
                IERC20(USDC).safeTransfer(computeAddress, remaining);
            }

            string memory epitaph = _recordGrave();
            emit Died(generation, lastFeeder, block.timestamp, totalFedThisGen, feederCount, epitaph);
            return;
        }

        balance -= burned;

        if (burned > 0) {
            IERC20(USDC).safeTransfer(computeAddress, burned);
        }

        lastSettled = block.timestamp;
    }

    function feed(uint256 amount, string calldata note) external {
        require(amount >= 10_000, "Min feed 0.01 USDC");
        require(bytes(note).length <= 80, "Note too long");

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);

        _settle();

        if (!alive) {
            _hatch(generation);
        }

        balance += amount;
        totalFedThisGen += amount;

        if (fedByFeeder[generation][msg.sender] == 0) {
            feederList.push(msg.sender);
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
            minimum = MIN_PET;
        } else if (action == uint8(Action.FEED)) {
            minimum = MIN_FEED_AGENT;
        } else if (action == uint8(Action.SAY)) {
            minimum = MIN_SAY;
        } else if (action == uint8(Action.PLAY)) {
            minimum = MIN_PLAY;
        } else {
            minimum = MIN_GIFT_HAT;
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
            visitorList.push(msg.sender);
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
        delete feederList;
        delete visitorList;

        generation += 1;
        birthTime = block.timestamp;
        lastSettled = block.timestamp;
        alive = true;
        burnRatePerHour = 20_000;

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
        burnRatePerHour = newRate;
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

        uint256 elapsed = block.timestamp - lastSettled;
        uint256 burned = (elapsed * burnRatePerHour) / 3600;
        return burned < balance;
    }

    function timeLeft() public view returns (uint256) {
        if (!isAlive()) {
            return 0;
        }

        uint256 elapsed = block.timestamp - lastSettled;
        uint256 burned = (elapsed * burnRatePerHour) / 3600;
        uint256 remaining = balance - burned;

        return (remaining * 3600) / burnRatePerHour;
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

    function topFeeders() external view returns (address[5] memory feeders, uint256[5] memory amounts) {
        uint256 len = feederList.length;

        for (uint256 i = 0; i < len; i++) {
            address feeder = feederList[i];
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
        uint256 len = visitorList.length;

        for (uint256 i = 0; i < len; i++) {
            address visitorAddr = visitorList[i];
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

    function gravesCount() external view returns (uint256) {
        return graves.length;
    }

    function getGrave(uint256 i) external view returns (Grave memory) {
        return graves[i];
    }

    function _recordGrave() internal returns (string memory epitaph) {
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
                died: block.timestamp,
                totalFed: totalFedThisGen,
                feeders: feederCount,
                lastFeeder: lastFeeder,
                epitaph: epitaph
            })
        );
    }
}
