// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PipWorld} from "../PipWorld.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// Random players hatch, feed, visit, wait and cross season boundaries.
contract WorldHandler is Test {
    PipWorld public world;
    MockERC20 public usdc;
    address[] public players;
    uint256 public maxId;

    constructor(PipWorld _w, MockERC20 _u) {
        world = _w;
        usdc = _u;
        for (uint256 i = 0; i < 8; i++) {
            address a = address(uint160(0xA11CE0 + i));
            players.push(a);
            usdc.mint(a, 1_000_000e6);
            vm.prank(a);
            usdc.approve(address(world), type(uint256).max);
        }
    }

    function hatch(uint256 who, uint256 amount) external {
        address a = players[who % players.length];
        amount = bound(amount, 50_000, 20e6);
        vm.prank(a);
        try world.hatch("p", amount) returns (uint256 id) {
            if (id > maxId) maxId = id;
        } catch {}
    }

    function feed(uint256 who, uint256 id, uint256 amount) external {
        if (maxId == 0) return;
        id = bound(id, 1, maxId);
        amount = bound(amount, 1_000, 5e6);
        vm.prank(players[who % players.length]);
        try world.feed(id, amount, "") {} catch {}
    }

    function visit(uint256 who, uint256 id, uint8 action) external {
        if (maxId == 0) return;
        id = bound(id, 1, maxId);
        action = uint8(bound(action, 0, 3));
        if (action == 1) action = 2;
        vm.prank(players[who % players.length]);
        try world.interact(id, action, "bot", "", 0, 5_000) {} catch {}
    }

    function wait(uint256 secs) external {
        skip(bound(secs, 1 minutes, 5 days));
    }

    function poke(uint256 id) external {
        if (maxId == 0) return;
        world.poke(bound(id, 1, maxId));
    }

    function withdraw(uint256 which) external {
        address a = which % 2 == 0 ? world.vault() : world.computeAddress();
        if (world.earnings(a) > 0) world.withdrawEarnings(a);
    }
}

contract PipWorldInvariantTest is Test {
    PipWorld world;
    MockERC20 usdc;
    WorldHandler handler;

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        world = new PipWorld(address(usdc), makeAddr("compute"), makeAddr("owner"), 42 days);
        handler = new WorldHandler(world, usdc);
        targetContract(address(handler));
    }

    /// USDC held == food of every pip + pantries + payouts owed
    function invariant_Accounting() public view {
        uint256 food;
        for (uint256 id = 1; id <= handler.maxId(); id++) {
            (PipWorld.Pet memory p,,,,,,) = world.petView(id);
            food += p.balance;
        }
        assertEq(usdc.balanceOf(address(world)), food + world.totalPantry() + world.totalEarningsOwed());
    }

    /// No pip ever reaches a stage before its minimum age, meals and friends
    function invariant_GrowthGates() public view {
        for (uint256 id = 1; id <= handler.maxId(); id++) {
            (PipWorld.Pet memory p,,,,,,) = world.petView(id);
            for (uint8 s = 0; s < p.stage; s++) {
                PipWorld.GrowthReq memory r = world.growthReq(s);
                assertGe(p.meals, r.meals);
                assertGe(p.visitors, r.visitors);
            }
            if (p.stage >= 1) assertGe(world.seasonEnd(p.season), p.bornAt + 2 days);
        }
    }

    /// Counted meals can never exceed one per 8 hours of life
    function invariant_MealCadence() public view {
        for (uint256 id = 1; id <= handler.maxId(); id++) {
            (PipWorld.Pet memory p,,,,,,) = world.petView(id);
            if (p.meals == 0) continue;
            assertLe((p.meals - 1) * 8 hours, p.lastMealAt - p.bornAt);
        }
    }

    /// At most one living pip per player
    function invariant_OneLivingPipEach() public view {
        for (uint256 i = 0; i < 8; i++) {
            address a = handler.players(i);
            uint256 living;
            uint256[] memory ids = world.petsOf(a);
            for (uint256 k = 0; k < ids.length; k++) {
                (, , uint8 status,,,,) = world.petView(ids[k]);
                if (status == 0) living++;
            }
            assertLe(living, 1);
        }
    }
}
