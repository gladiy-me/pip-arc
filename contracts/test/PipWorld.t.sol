// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PipWorld} from "../PipWorld.sol";
import {PipWorldVault} from "../PipWorldVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract LaunchTarget {}

contract PipWorldTest is Test {
    uint256 constant SEASON = 42 days;
    MockERC20 usdc;
    PipWorld world;
    PipWorldVault vault;
    address owner = makeAddr("owner");
    address compute = makeAddr("compute");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        world = new PipWorld(address(usdc), compute, owner, SEASON);
        vault = PipWorldVault(world.vault());
        _fund(alice);
        _fund(bob);
    }

    function _fund(address who) internal {
        usdc.mint(who, 1_000e6);
        vm.prank(who);
        usdc.approve(address(world), type(uint256).max);
    }

    function _hatch(address who, string memory name, uint256 amount) internal returns (uint256 id) {
        vm.prank(who);
        id = world.hatch(name, amount);
    }

    function _feed(address who, uint256 id, uint256 amount) internal {
        vm.prank(who);
        world.feed(id, amount, "");
    }

    function _stage(uint256 id) internal view returns (uint8) {
        (PipWorld.Pet memory p,,,,,,) = world.petView(id);
        return p.stage;
    }

    function _pet(uint256 id) internal view returns (PipWorld.Pet memory p, uint8 status, uint256 bal) {
        (p,, status, bal,,,) = world.petView(id);
    }

    /// friends: wallets that own a pip at least 3 days old
    function _makeFriends(uint256 n) internal returns (address[] memory fs) {
        fs = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            fs[i] = address(uint160(0xF00D00 + i));
            _fund(fs[i]);
            _hatch(fs[i], "friend", 5e6);
        }
    }

    // ── hatching ──────────────────────────────────────────────────────────

    function test_HatchMintsSoulboundPip() public {
        uint256 id = _hatch(alice, "mochi", 50_000);
        assertEq(id, 1);
        assertEq(world.ownerOf(id), alice);
        assertEq(world.activePet(alice), id);
        (PipWorld.Pet memory p, uint8 status, uint256 bal) = _pet(id);
        assertEq(p.name, "mochi");
        assertEq(p.season, 1);
        assertEq(p.stage, 0);
        assertEq(status, 0);
        assertEq(bal, 50_000);
        assertEq(p.lineDepth, 1);
    }

    function test_HatchNeedsFoodAndAValidName() public {
        vm.startPrank(alice);
        vm.expectRevert(bytes("Not enough food to hatch"));
        world.hatch("x", 49_999);
        vm.expectRevert(bytes("Name 1-24 bytes"));
        world.hatch("", 50_000);
        vm.expectRevert(bytes("Name has a forbidden character"));
        world.hatch('bad"name', 50_000);
        vm.stopPrank();
    }

    function test_OneLivingPipPerWallet() public {
        _hatch(alice, "a", 1e6);
        vm.prank(alice);
        vm.expectRevert(bytes("You already have a living pip"));
        world.hatch("b", 1e6);
    }

    // ── metabolism & permadeath ───────────────────────────────────────────

    function test_DeathIsPermanentAndYouCanHatchAgain() public {
        uint256 id = _hatch(alice, "short", 50_000); // 50 hours at 0.001/h
        skip(51 hours);
        world.poke(id);
        (PipWorld.Pet memory p, uint8 status,) = _pet(id);
        assertEq(status, 1, "dead");
        assertEq(p.endedAt, block.timestamp - 1 hours, "real time of death");
        assertEq(world.activePet(alice), 0);

        vm.prank(bob);
        vm.expectRevert(bytes("pip is not alive"));
        world.feed(id, 1e6, "too late");

        uint256 id2 = _hatch(alice, "again", 50_000);
        (PipWorld.Pet memory p2,,) = _pet(id2);
        assertEq(p2.parentId, 0, "dead parent breaks the line");
        assertEq(world.ownerOf(id), alice, "tombstone stays in the collection");
    }

    function test_SplitNinetyTen() public {
        uint256 id = _hatch(alice, "a", 1e6);
        skip(100 hours);
        world.poke(id);
        assertEq(world.earnings(address(vault)), 90_000);
        assertEq(world.earnings(compute), 10_000);
    }

    // ── meals & growth ────────────────────────────────────────────────────

    function test_BigFeedDoesNotSpeedUpGrowth() public {
        uint256 id = _hatch(alice, "rich", 50_000);
        _feed(alice, id, 100e6); // a whale meal
        _feed(alice, id, 100e6); // same moment: not counted (cooldown)
        (PipWorld.Pet memory p,,) = _pet(id);
        assertEq(p.meals, 1);
        assertEq(p.stage, 0);
    }

    function test_SmallFeedIsNotAMeal() public {
        uint256 id = _hatch(alice, "a", 50_000);
        _feed(alice, id, 23_999); // < one day of mochi food
        (PipWorld.Pet memory p,,) = _pet(id);
        assertEq(p.meals, 0);
    }

    function test_FastestPossibleMochiToPip() public {
        uint256 id = _hatch(alice, "a", 1e6);
        for (uint256 i = 0; i < 6; i++) {
            _feed(alice, id, 24_000);
            if (i < 5) skip(8 hours);
        }
        // 6 meals done at t = 40h, but the stage also needs 2 days of age
        assertEq(_stage(id), 0);
        skip(8 hours); // t = 48h
        _feed(alice, id, 24_000);
        assertEq(_stage(id), 1, "pip at exactly 2 days");
    }

    function test_BigPipNeedsFriends() public {
        address[] memory fs = _makeFriends(3);
        uint256 id = _hatch(alice, "a", 5e6);
        // 18 meals every 8h = 6 days; age gate is 10 days
        for (uint256 i = 0; i < 31; i++) {
            _feed(alice, id, 48_000);
            skip(8 hours);
        }
        _feed(alice, id, 48_000);
        assertEq(_stage(id), 1, "no friends yet");

        // a stranger (no pip) does not count as a friend
        address stranger = makeAddr("stranger");
        _fund(stranger);
        vm.prank(stranger);
        world.interact(id, 0, "bot", "hi", 0, 100);
        (PipWorld.Pet memory p,,) = _pet(id);
        assertEq(p.visitors, 0);

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(fs[i]);
            world.interact(id, 0, "friend", "hi", 0, 100);
        }
        // the same friend twice still counts once
        vm.prank(fs[0]);
        world.interact(id, 0, "friend", "again", 0, 100);
        (p,,) = _pet(id);
        assertEq(p.visitors, 3);
        assertEq(p.stage, 2, "big pip");
    }

    function test_YoungPipOwnersAreNotFriendsYet() public {
        address newbie = makeAddr("newbie");
        _fund(newbie);
        _hatch(newbie, "baby", 1e6);
        uint256 id = _hatch(alice, "a", 1e6);
        vm.prank(newbie);
        world.interact(id, 0, "", "", 0, 100);
        (PipWorld.Pet memory p,,) = _pet(id);
        assertEq(p.visitors, 0, "pip < 3 days old");
        skip(3 days);
        vm.prank(newbie);
        world.interact(id, 0, "", "", 0, 100);
        (p,,) = _pet(id);
        assertEq(p.visitors, 1);
    }

    function test_MetabolismGrowsWithStage() public {
        assertEq(world.burnRateOf(0), 1_000);
        assertEq(world.burnRateOf(1), 2_000);
        assertEq(world.burnRateOf(2), 4_000);
        assertEq(world.burnRateOf(3), 6_000);
        assertEq(world.mealSizeOf(1), 48_000);
    }

    // ── seasons ───────────────────────────────────────────────────────────

    function _raiseToPip(address who, uint256 id) internal {
        for (uint256 i = 0; i < 7; i++) {
            _feed(who, id, 48_000);
            skip(8 hours);
        }
        assertEq(_stage(id), 1);
    }

    function test_SeasonEndRetiresIntoCollectionWithPantry() public {
        uint256 id = _hatch(alice, "s1", 5e6);
        _raiseToPip(alice, id);
        vm.warp(world.seasonEnd(1) + 1 hours);
        world.poke(id);

        (PipWorld.Pet memory p, uint8 status,) = _pet(id);
        assertEq(status, 2, "retired");
        assertEq(p.stage, 1, "frozen in its final stage");
        assertEq(p.endedAt, world.seasonEnd(1));
        uint256 pantry = world.pantry(alice);
        assertGt(pantry, 0, "leftover food saved");

        vm.prank(bob);
        vm.expectRevert(bytes("pip is not alive"));
        world.feed(id, 1e6, "");

        // next season: the pantry becomes the egg's food, and the line continues
        uint256 id2 = _hatch(alice, "s2", 0);
        (PipWorld.Pet memory c, , uint256 bal) = _pet(id2);
        assertEq(c.season, 2);
        assertEq(bal, pantry);
        assertEq(world.pantry(alice), 0);
        assertEq(c.parentId, id);
        assertEq(c.lineDepth, 2);
        assertEq(c.trait & 0xff, p.trait & 0xff, "family colour inherited");
        assertEq(world.balanceOf(alice), 2, "both pips in the collection");
    }

    function test_MochiThatSurvivesDoesNotStartALine() public {
        uint256 id = _hatch(alice, "lazy", 50e6);
        vm.warp(world.seasonEnd(1));
        world.poke(id);
        uint256 id2 = _hatch(alice, "next", 0);
        (PipWorld.Pet memory c,,) = _pet(id2);
        assertEq(c.parentId, 0, "only stage >= 1 passes on a trait");
    }

    function test_SeasonEndStopsMetabolism() public {
        uint256 id = _hatch(alice, "s1", 50e6);
        vm.warp(world.seasonEnd(1) + 30 days);
        world.poke(id);
        uint256 burned = world.earnings(address(vault)) + world.earnings(compute);
        assertEq(burned, (SEASON * 1_000) / 3600, "billed only until the season ended");
    }

    // ── soulbound ─────────────────────────────────────────────────────────

    function test_SoulboundUntilEnabledAndLivingNeverMoves() public {
        uint256 id = _hatch(alice, "a", 1e6);
        vm.prank(alice);
        vm.expectRevert(bytes("pip is soulbound for now"));
        world.transferFrom(alice, bob, id);

        vm.prank(owner);
        world.enableTransfers();
        vm.prank(alice);
        vm.expectRevert(bytes("Living pips can't move"));
        world.transferFrom(alice, bob, id);

        vm.warp(world.seasonEnd(1));
        vm.prank(alice);
        world.transferFrom(alice, bob, id);
        assertEq(world.ownerOf(id), bob, "retired pips can be traded once enabled");
    }

    // ── accounting ────────────────────────────────────────────────────────

    function test_AccountingInvariant() public {
        uint256 a = _hatch(alice, "a", 5e6);
        uint256 b = _hatch(bob, "b", 60_000);
        skip(70 hours); // b dies
        _feed(alice, a, 1e6);
        world.poke(b);
        vm.warp(world.seasonEnd(1));
        world.poke(a);
        (, , uint256 balA) = _pet(a);
        (, , uint256 balB) = _pet(b);
        assertEq(usdc.balanceOf(address(world)), balA + balB + world.totalPantry() + world.totalEarningsOwed());
    }

    // ── vault ─────────────────────────────────────────────────────────────

    function test_VaultFoodBankAfterAYear() public {
        uint256 id = _hatch(alice, "a", 1e6);
        skip(200 hours);
        world.poke(id);
        vm.expectRevert(bytes("Not in food bank mode"));
        vault.feedPet(id);

        vm.warp(vault.deadline());
        uint256 id2 = _hatch(bob, "late", 1e6);
        vault.feedPet(id2);
        (PipWorld.Pet memory p,,) = _pet(id2);
        assertEq(p.meals, 0, "vault meals never count towards growth");
        vm.expectRevert(bytes("Already fed today"));
        vault.feedPet(id2);
    }

    function test_VaultLaunchIsTimelockedAndContractOnly() public {
        uint256 id = _hatch(alice, "a", 1e6);
        skip(100 hours);
        world.poke(id);
        vm.startPrank(owner);
        vm.expectRevert(bytes("Target must be a contract"));
        vault.proposeLaunch(owner);
        address target = address(new LaunchTarget());
        vault.proposeLaunch(target);
        vm.expectRevert(bytes("Timelock"));
        vault.executeLaunch();
        skip(14 days);
        vault.executeLaunch();
        vm.stopPrank();
        assertGt(usdc.balanceOf(target), 0);
    }

    // ── fuzz: growth can't be rushed ──────────────────────────────────────

    function testFuzz_NoStageBeforeItsAge(uint256 seed) public {
        address[] memory fs = _makeFriends(10);
        skip(3 days);
        uint256 id = _hatch(alice, "rush", 50e6);
        uint256 born = block.timestamp;
        for (uint256 i = 0; i < 60; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            skip(seed % 10 hours);
            address who = fs[seed % 10];
            vm.prank(who);
            world.feed(id, 1e6, "");
            uint8 st = _stage(id);
            uint256 age = block.timestamp - born;
            if (st >= 1) assertGe(age, 2 days);
            if (st >= 2) assertGe(age, 10 days);
            if (st >= 3) assertGe(age, 28 days);
        }
    }
}
