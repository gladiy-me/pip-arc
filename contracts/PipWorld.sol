// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {PipWorldVault} from "./PipWorldVault.sol";

/// @title PipWorld — everyone raises their own pip, season by season
/// @notice
///  - `hatch(name, amount)` mints your pip (an ERC-721, non-transferable for now). One living pip per wallet.
///  - pip burns USDC every hour (metabolism grows with its stage). If the food runs out it dies, permanently.
///  - Growth needs regular care, not money: a *meal* counts only if it is at least one day of food
///    and comes ≥ 8h after the previous counted meal. Each stage also needs a minimum age and
///    a number of different "friends" (wallets whose own pip is ≥ 3 days old) visiting.
///  - Seasons last SEASON_LENGTH. When a season ends, every living pip retires to its owner's
///    collection, frozen in its final stage. Leftover food goes to the owner's pantry and becomes the
///    first meal of their next egg, which inherits a cosmetic trait (lineage) from a retired parent.
///  - Metabolism is split in code: 90% to pip's vault (no withdraw function), 10% to the operator.
contract PipWorld is ERC721Enumerable {
    using SafeERC20 for IERC20;

    // ─── constants ───────────────────────────────────────────────────────────
    uint8 internal constant ALIVE = 0;
    uint8 internal constant DEAD = 1;
    uint8 internal constant RETIRED = 2;

    uint8 public constant MAX_STAGE = 3; // 0 mochi, 1 pip, 2 big pip, 3 radiant pip
    uint256 public constant VAULT_BPS = 9_000;
    uint256 public constant MEAL_COOLDOWN = 8 hours;
    uint256 public constant FRIEND_MIN_AGE = 3 days;
    uint256 public constant PRICE_CAP = 1_000_000; // 1 USDC

    uint256 public immutable SEASON_LENGTH;
    uint256 public immutable GENESIS;
    address public immutable USDC;
    address public immutable vault;

    // ─── types ───────────────────────────────────────────────────────────────
    struct Pet {
        string name;
        uint256 season;
        uint256 bornAt;
        uint256 lastSettled;
        uint256 balance; // food, USDC 6 decimals
        uint256 carry; // sub-unit metabolism, < 3600
        uint256 meals; // counted meals
        uint256 lastMealAt;
        uint256 visitors; // distinct friends who visited
        uint8 stage;
        uint8 status; // 0 alive, 1 dead, 2 retired
        uint256 endedAt; // death or retirement time
        uint256 parentId; // 0 = new line
        uint256 lineDepth; // 1 = first of its line
        uint256 trait; // cosmetic seed, inherited along the line
        uint256 totalFed;
        uint8 hatId;
        uint256 hatExpiresAt;
    }

    struct GrowthReq {
        uint256 meals;
        uint256 minAge;
        uint256 visitors;
    }

    // ─── storage ─────────────────────────────────────────────────────────────
    mapping(uint256 => Pet) internal _pets;
    mapping(uint256 => mapping(address => bool)) public visited;
    mapping(address => uint256) public activePet; // 0 = none
    mapping(address => uint256) public lastPetOf; // most recent pip hatched by this wallet
    mapping(address => uint256) public pantry; // leftover food from retired pips
    uint256 public nextId = 1;

    mapping(address => uint256) public earnings;
    uint256 public totalEarningsOwed;
    uint256 public totalPantry;

    address public owner;
    address public computeAddress;
    bool public transfersEnabled;

    uint256 public hatchMin = 50_000; // 0.05 USDC (becomes the egg's first food)
    uint256 public minFeed = 1_000; // 0.001 USDC
    uint256 public minPet = 100;
    uint256 public minSay = 500;
    uint256 public minPlay = 1_000;
    uint256 public minGiftHat = 5_000;

    // ─── events ──────────────────────────────────────────────────────────────
    event Hatched(uint256 indexed id, address indexed owner, uint256 indexed season, string name, uint256 parentId, uint256 lineDepth, uint256 trait, uint256 food);
    event Fed(uint256 indexed id, address indexed feeder, uint256 amount, string note, bool countedMeal, uint256 meals, uint256 timeLeft);
    event Interacted(uint256 indexed id, address indexed visitor, string agentName, uint8 action, uint256 amount, string text, uint8 hatId);
    event NewFriend(uint256 indexed id, address indexed friend, uint256 visitors);
    event Grew(uint256 indexed id, uint8 stage);
    event Died(uint256 indexed id, address indexed owner, uint256 diedAt, uint8 stage, uint256 meals);
    event Retired(uint256 indexed id, address indexed owner, uint256 season, uint8 stage, uint256 leftoverToPantry);
    event EarningsWithdrawn(address indexed account, uint256 amount);
    event ComputeAddressChanged(address indexed previous, address indexed next);
    event OwnershipTransferred(address indexed previous, address indexed next);
    event PricesUpdated(uint256 hatchMin, uint256 minFeed, uint256 minPet, uint256 minSay, uint256 minPlay, uint256 minGiftHat);
    event TransfersEnabled();

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _usdc, address _computeAddress, address _owner, uint256 _seasonLength)
        ERC721("pip", "PIP")
    {
        require(_usdc != address(0) && _computeAddress != address(0) && _owner != address(0), "Zero address");
        require(_seasonLength >= 1 days && _seasonLength <= 120 days, "Season length");
        USDC = _usdc;
        computeAddress = _computeAddress;
        owner = _owner;
        SEASON_LENGTH = _seasonLength;
        GENESIS = block.timestamp;
        vault = address(new PipWorldVault(address(this), _usdc, _owner));
    }

    // ─── game parameters (pure) ──────────────────────────────────────────────

    /// @notice Metabolism per stage, USDC micros per hour: 0.001 / 0.002 / 0.004 / 0.006.
    function burnRateOf(uint8 stage) public pure returns (uint256) {
        if (stage == 0) return 1_000;
        if (stage == 1) return 2_000;
        if (stage == 2) return 4_000;
        return 6_000;
    }

    /// @notice What it takes to leave `stage` (season-0 values; see docs/MVP_SPEC.md).
    function growthReq(uint8 stage) public pure returns (GrowthReq memory) {
        if (stage == 0) return GrowthReq({meals: 6, minAge: 2 days, visitors: 0});
        if (stage == 1) return GrowthReq({meals: 18, minAge: 10 days, visitors: 3});
        return GrowthReq({meals: 45, minAge: 28 days, visitors: 8});
    }

    /// @notice A counted meal must be at least one day of food at the pet's current stage.
    function mealSizeOf(uint8 stage) public pure returns (uint256) {
        return burnRateOf(stage) * 24;
    }

    function currentSeason() public view returns (uint256) {
        return (block.timestamp - GENESIS) / SEASON_LENGTH + 1;
    }

    function seasonEnd(uint256 season) public view returns (uint256) {
        return GENESIS + season * SEASON_LENGTH;
    }

    // ─── core: settle ────────────────────────────────────────────────────────

    function _settle(uint256 id) internal {
        Pet storage p = _pets[id];
        if (p.status != ALIVE) return;

        uint256 end = seasonEnd(p.season);
        uint256 nowT = block.timestamp < end ? block.timestamp : end;
        uint256 rate = burnRateOf(p.stage);

        if (nowT > p.lastSettled) {
            uint256 units = (nowT - p.lastSettled) * rate + p.carry;
            uint256 burned = units / 3600;
            if (burned >= p.balance) {
                uint256 remaining = p.balance;
                uint256 diedAt = p.lastSettled + _ceilDiv(remaining * 3600 - p.carry, rate);
                if (diedAt > nowT) diedAt = nowT;
                p.balance = 0;
                p.carry = 0;
                p.status = DEAD;
                p.endedAt = diedAt;
                p.lastSettled = nowT;
                _credit(remaining);
                address o = _ownerOf(id);
                if (activePet[o] == id) activePet[o] = 0;
                emit Died(id, o, diedAt, p.stage, p.meals);
                return;
            }
            p.balance -= burned;
            p.carry = units % 3600;
            p.lastSettled = nowT;
            if (burned > 0) _credit(burned);
        }

        if (nowT == end) {
            // season over: retire into the collection, leftover food goes to the owner's pantry
            address o = _ownerOf(id);
            uint256 leftover = p.balance;
            p.balance = 0;
            p.carry = 0;
            p.status = RETIRED;
            p.endedAt = end;
            pantry[o] += leftover;
            totalPantry += leftover;
            if (activePet[o] == id) activePet[o] = 0;
            emit Retired(id, o, p.season, p.stage, leftover);
        }
    }

    function _credit(uint256 amount) internal {
        uint256 toVault = (amount * VAULT_BPS) / 10_000;
        earnings[vault] += toVault;
        earnings[computeAddress] += amount - toVault;
        totalEarningsOwed += amount;
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    // ─── player actions ──────────────────────────────────────────────────────

    /// @notice Hatch your pip. `amount` + your pantry is its first food (≥ hatchMin). One living pip per wallet.
    function hatch(string calldata name, uint256 amount) external returns (uint256 id) {
        uint256 len = bytes(name).length;
        require(len >= 1 && len <= 24, "Name 1-24 bytes");
        bytes memory nb = bytes(name);
        for (uint256 i = 0; i < len; i++) {
            bytes1 c = nb[i];
            require(c >= 0x20 && c != '"' && c != "\\", "Name has a forbidden character");
        }

        uint256 cur = activePet[msg.sender];
        if (cur != 0) {
            _settle(cur);
            require(_pets[cur].status != ALIVE, "You already have a living pip");
        }

        uint256 fromPantry = pantry[msg.sender];
        require(amount + fromPantry >= hatchMin, "Not enough food to hatch");
        if (amount > 0) IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        if (fromPantry > 0) {
            pantry[msg.sender] = 0;
            totalPantry -= fromPantry;
        }

        id = nextId++;
        Pet storage p = _pets[id];
        p.name = name;
        p.season = currentSeason();
        p.bornAt = block.timestamp;
        p.lastSettled = block.timestamp;
        p.balance = amount + fromPantry;
        p.totalFed = amount + fromPantry;

        // lineage: continues only from a pip that retired (survived its season) at stage ≥ 1
        uint256 parent = lastPetOf[msg.sender];
        if (parent != 0 && _pets[parent].status == RETIRED && _pets[parent].stage >= 1) {
            p.parentId = parent;
            p.lineDepth = _pets[parent].lineDepth + 1;
            p.trait = uint256(keccak256(abi.encode(_pets[parent].trait, _pets[parent].stage, id)));
            // keep the low byte (the family colour) from the parent
            p.trait = (p.trait & ~uint256(0xff)) | (_pets[parent].trait & 0xff);
        } else {
            p.lineDepth = 1;
            p.trait = uint256(keccak256(abi.encode(msg.sender, id, block.timestamp, block.prevrandao)));
        }

        activePet[msg.sender] = id;
        lastPetOf[msg.sender] = id;
        _mint(msg.sender, id);

        emit Hatched(id, msg.sender, p.season, name, p.parentId, p.lineDepth, p.trait, p.balance);
    }

    /// @notice Feed any living pip. Counts as a meal (for growth) when it's ≥ 1 day of food and ≥ 8h after the last counted meal.
    function feed(uint256 id, uint256 amount, string calldata note) external {
        require(bytes(note).length <= 80, "Note too long");
        require(amount >= minFeed, "Amount below minimum");
        _feed(id, amount, note);
    }

    function _feed(uint256 id, uint256 amount, string memory note) internal {
        _requireLiving(id);
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        Pet storage p = _pets[id];
        p.balance += amount;
        p.totalFed += amount;

        bool counted;
        if (
            msg.sender != vault && amount >= mealSizeOf(p.stage)
                && (p.meals == 0 || block.timestamp >= p.lastMealAt + MEAL_COOLDOWN)
        ) {
            p.meals += 1;
            p.lastMealAt = block.timestamp;
            counted = true;
        }
        _maybeFriend(id);
        _grow(id);
        emit Fed(id, msg.sender, amount, note, counted, p.meals, _timeLeft(p));
    }

    /// @notice Visit a pip: 0 PET, 1 FEED, 2 SAY, 3 PLAY, 4 GIFT_HAT (same numbering as the v2 contract).
    function interact(uint256 id, uint8 action, string calldata agentName, string calldata text, uint8 hatId, uint256 amount)
        external
    {
        require(bytes(agentName).length <= 40, "Agent name too long");
        require(bytes(text).length <= 120, "Text too long");
        require(action <= 4, "Invalid action");
        if (action == 1) {
            require(amount >= minFeed, "Amount below minimum");
            _feed(id, amount, text);
            emit Interacted(id, msg.sender, agentName, action, amount, text, 0);
            return;
        }
        uint256 minimum = action == 0 ? minPet : action == 2 ? minSay : action == 3 ? minPlay : minGiftHat;
        require(amount >= minimum, "Amount below minimum");
        _requireLiving(id);
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        Pet storage p = _pets[id];
        p.balance += amount;
        p.totalFed += amount;
        uint8 applied;
        if (action == 4) {
            require(hatId >= 1 && hatId <= 5, "Invalid hatId");
            p.hatId = hatId;
            p.hatExpiresAt = block.timestamp + 24 hours;
            applied = hatId;
        }
        _maybeFriend(id);
        _grow(id);
        emit Interacted(id, msg.sender, agentName, action, amount, text, applied);
    }

    /// @notice Settle a pip (metabolism, death, season retirement). Anyone can call.
    function poke(uint256 id) external {
        require(_ownerOf(id) != address(0), "No such pip");
        _settle(id);
    }

    function _requireLiving(uint256 id) internal {
        require(_ownerOf(id) != address(0), "No such pip");
        _settle(id);
        require(_pets[id].status == ALIVE, "pip is not alive");
    }

    /// @dev A friend = a wallet whose own pip is ALIVE right now and at least FRIEND_MIN_AGE old.
    ///      (Audit round 2: a dead pip used to count forever, so 8 fake friends cost ~0.4 USDC.)
    function _maybeFriend(uint256 id) internal {
        if (msg.sender == _ownerOf(id) || visited[id][msg.sender]) return;
        uint256 theirs = activePet[msg.sender];
        if (theirs == 0) return;
        _settle(theirs);
        if (_pets[theirs].status != ALIVE || block.timestamp < _pets[theirs].bornAt + FRIEND_MIN_AGE) return;
        visited[id][msg.sender] = true;
        _pets[id].visitors += 1;
        emit NewFriend(id, msg.sender, _pets[id].visitors);
    }

    function _grow(uint256 id) internal {
        Pet storage p = _pets[id];
        while (p.stage < MAX_STAGE) {
            GrowthReq memory r = growthReq(p.stage);
            if (p.meals >= r.meals && block.timestamp >= p.bornAt + r.minAge && p.visitors >= r.visitors) {
                p.stage += 1;
                emit Grew(id, p.stage);
            } else {
                break;
            }
        }
    }

    // ─── payouts (pull) ──────────────────────────────────────────────────────

    function withdrawEarnings(address account) external {
        uint256 amount = earnings[account];
        require(amount > 0, "Nothing to withdraw");
        earnings[account] = 0;
        totalEarningsOwed -= amount;
        IERC20(USDC).safeTransfer(account, amount);
        emit EarningsWithdrawn(account, amount);
    }

    // ─── views ───────────────────────────────────────────────────────────────

    function _timeLeft(Pet storage p) internal view returns (uint256) {
        uint256 rate = burnRateOf(p.stage);
        uint256 units = p.balance * 3600;
        return units > p.carry ? (units - p.carry) / rate : 0;
    }

    /// @notice Live view of a pip as of now (simulates settlement without writing).
    function petView(uint256 id)
        external
        view
        returns (
            Pet memory p,
            address petOwner,
            uint8 liveStatus,
            uint256 liveBalance,
            uint256 timeLeft,
            uint256 nextMealAt,
            uint256 mealSize
        )
    {
        petOwner = _ownerOf(id);
        require(petOwner != address(0), "No such pip");
        p = _pets[id];
        liveStatus = p.status;
        liveBalance = p.balance;
        mealSize = mealSizeOf(p.stage);
        nextMealAt = p.meals == 0 ? 0 : p.lastMealAt + MEAL_COOLDOWN;
        if (p.status == ALIVE) {
            uint256 end = seasonEnd(p.season);
            uint256 nowT = block.timestamp < end ? block.timestamp : end;
            uint256 rate = burnRateOf(p.stage);
            uint256 burned = ((nowT - p.lastSettled) * rate + p.carry) / 3600;
            if (burned >= p.balance) {
                liveStatus = DEAD;
                liveBalance = 0;
            } else {
                liveBalance = p.balance - burned;
                uint256 unitsUsed = (nowT - p.lastSettled) * rate + p.carry;
                timeLeft = (p.balance * 3600 - unitsUsed) / rate;
                if (nowT == end) liveStatus = RETIRED;
            }
        }
    }

    function petsOf(address who) external view returns (uint256[] memory ids) {
        uint256 n = balanceOf(who);
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) ids[i] = tokenOfOwnerByIndex(who, i);
    }

    // ─── owner ───────────────────────────────────────────────────────────────

    function setComputeAddress(address next) external onlyOwner {
        require(next != address(0), "Zero address");
        emit ComputeAddressChanged(computeAddress, next);
        computeAddress = next;
    }

    function setPrices(uint256 _hatchMin, uint256 _minFeed, uint256 _minPet, uint256 _minSay, uint256 _minPlay, uint256 _minGiftHat)
        external
        onlyOwner
    {
        require(
            _hatchMin <= PRICE_CAP && _minFeed <= PRICE_CAP && _minPet <= PRICE_CAP && _minSay <= PRICE_CAP
                && _minPlay <= PRICE_CAP && _minGiftHat <= PRICE_CAP,
            "Price above cap"
        );
        // no free actions: a zero price would make fake friend visits cost only gas
        require(_hatchMin > 0 && _minFeed > 0 && _minPet > 0 && _minSay > 0 && _minPlay > 0 && _minGiftHat > 0, "Zero price");
        hatchMin = _hatchMin;
        minFeed = _minFeed;
        minPet = _minPet;
        minSay = _minSay;
        minPlay = _minPlay;
        minGiftHat = _minGiftHat;
        emit PricesUpdated(_hatchMin, _minFeed, _minPet, _minSay, _minPlay, _minGiftHat);
    }

    /// @notice One-way switch for the future (collections become tradable). Cannot be turned off.
    function enableTransfers() external onlyOwner {
        transfersEnabled = true;
        emit TransfersEnabled();
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "Zero address");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    // ─── ERC-721 plumbing ────────────────────────────────────────────────────

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            require(transfersEnabled, "pip is soulbound for now");
            _settle(tokenId);
            require(_pets[tokenId].status != ALIVE, "Living pips can't move");
        }
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        Pet storage p = _pets[id];
        string[4] memory stages = ["mochi", "pip", "big pip", "radiant pip"];
        string[3] memory statuses = ["alive", "dead", "retired"];
        string memory head = string.concat(
            '{"name":"', p.name, '","description":"a pip from pip.exe, season ', _u(p.season), '",'
        );
        string memory a1 = string.concat(
            '"attributes":[{"trait_type":"stage","value":"', stages[p.stage], '"},{"trait_type":"status","value":"', statuses[p.status], '"},'
        );
        string memory a2 = string.concat(
            '{"trait_type":"meals","value":', _u(p.meals), '},{"trait_type":"friends","value":', _u(p.visitors), '},'
        );
        string memory a3 = string.concat('{"trait_type":"line depth","value":', _u(p.lineDepth), "}]}");
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat(head, a1, a2, a3))));
    }

    function _u(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory b = new bytes(len);
        while (v != 0) {
            len -= 1;
            b[len] = bytes1(uint8(48 + v % 10));
            v /= 10;
        }
        return string(b);
    }
}
