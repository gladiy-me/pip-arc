// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Pip} from "../Pip.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Mock USDC with a blacklist, like real USDC: transfers to/from a blacklisted address revert.
contract BlacklistUSDC is MockERC20 {
    mapping(address => bool) public blacklisted;

    constructor() MockERC20("USDC", "USDC", 6) {}

    function setBlacklisted(address a, bool b) external {
        blacklisted[a] = b;
    }

    function _transfer(address from, address to, uint256 value) internal override {
        require(!blacklisted[from] && !blacklisted[to], "Blacklisted");
        super._transfer(from, to, value);
    }
}

/// @title Regression tests for the fixes made in review (see CHANGES_REVIEW.md)
contract PipFixesTest is Test {
    uint256 constant RATE = 1_000; // planned mainnet rate: 0.001 USDC/h

    BlacklistUSDC usdc;
    Pip pip;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address compute = makeAddr("compute");

    function setUp() public {
        usdc = new BlacklistUSDC();
        pip = new Pip(address(usdc), compute, owner, RATE);
        usdc.mint(alice, 100e6);
        usdc.mint(bob, 100e6);
        vm.prank(alice);
        usdc.approve(address(pip), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(pip), type(uint256).max);
    }

    // ── FIX 1: zero-balance underflow brick ────────────────────────────────

    function test_Fix1_FirstFeedLongAfterDeployWorks() public {
        skip(30 days);
        pip.poke(); // used to revert (underflow)

        vm.prank(alice);
        pip.feed(1e6, "first meal, a month late");

        assertTrue(pip.isAlive());
        assertEq(pip.generation(), 1, "same generation, no fake death");
        assertEq(pip.balance(), 1e6, "nothing burned while empty");
        assertEq(pip.gravesCount(), 0);
    }

    function test_Fix1_AdminCallsWorkBeforeFirstFeed() public {
        skip(1 days);
        vm.startPrank(owner);
        pip.setComputeAddress(makeAddr("other"));
        pip.setBurnRate(2_000);
        vm.stopPrank();
    }

    // ── FIX 2: setBurnRate is no longer retroactive ────────────────────────

    function test_Fix2_SetBurnRateSettlesAtOldRateFirst() public {
        vm.prank(alice);
        pip.feed(1e6, "");
        skip(6 hours);

        vm.prank(owner);
        pip.setBurnRate(200_000);

        assertTrue(pip.isAlive(), "pip survives a rate change");
        assertEq(pip.balance(), 1e6 - 6 * RATE, "6h billed at the OLD rate");
        assertEq(pip.earnings(compute), 6 * RATE);
    }

    function test_Fix2_EmitsBurnRateChanged() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(pip));
        emit Pip.BurnRateChanged(RATE, 5_000);
        pip.setBurnRate(5_000);
    }

    // ── FIX 3: pull-payment, blacklisted computeAddress can't brick pip ────

    function test_Fix3_BlacklistedComputeDoesNotBlockFeeding() public {
        vm.prank(alice);
        pip.feed(1e6, "");
        skip(10 hours);

        usdc.setBlacklisted(compute, true);

        // feeding, poking, interacting all still work
        vm.prank(bob);
        pip.feed(1e6, "still works");
        pip.poke();
        vm.prank(bob);
        pip.interact(0, "bot", "hi", 0, 100);

        // owner can rotate away from the blacklisted address
        address fresh = makeAddr("fresh");
        vm.prank(owner);
        pip.setComputeAddress(fresh);
        assertEq(pip.computeAddress(), fresh);

        // the blacklisted address's own payout reverts, but only that call
        vm.expectRevert(bytes("Blacklisted"));
        pip.withdrawEarnings(compute);

        // new metabolism goes to the fresh address and is withdrawable
        skip(5 hours);
        pip.withdrawEarnings(fresh);
        assertEq(usdc.balanceOf(fresh), 5 * RATE);
    }

    function test_Fix3_AccountingInvariant() public {
        vm.prank(alice);
        pip.feed(3e6, "");
        skip(100 hours);
        vm.prank(bob);
        pip.interact(1, "bot", "", 0, 1_000);
        skip(7 hours);
        pip.poke();
        // contract always holds exactly pip's balance + what it owes recipients
        assertEq(usdc.balanceOf(address(pip)), pip.balance() + pip.totalEarningsOwed());
        pip.withdrawEarnings(compute);
        assertEq(usdc.balanceOf(address(pip)), pip.balance());
        assertEq(usdc.balanceOf(compute), 107 * RATE);
    }

    function test_Fix3_WithdrawNothingReverts() public {
        vm.expectRevert(bytes("Nothing to withdraw"));
        pip.withdrawEarnings(alice);
    }

    // ── FIX 4: per-generation lists, revival is O(1) ───────────────────────

    function _reviveGasWith(uint256 n) internal returns (uint256 used, Pip p) {
        p = new Pip(address(usdc), compute, owner, RATE);
        for (uint256 i = 1; i <= n; i++) {
            address a = address(uint160(0x10000 + i));
            usdc.mint(a, 1e6);
            vm.startPrank(a);
            usdc.approve(address(p), type(uint256).max);
            p.feed(1_000, "");
            vm.stopPrank();
        }
        skip(365 days);
        vm.prank(alice);
        usdc.approve(address(p), type(uint256).max);
        uint256 g = gasleft();
        vm.prank(alice);
        p.feed(1_000, "revive");
        used = g - gasleft();
    }

    function test_Fix4_ListsArePerGenerationAndRevivalIsCheap() public {
        (uint256 small,) = _reviveGasWith(3);
        (uint256 big, Pip p) = _reviveGasWith(300);

        // old code deleted the whole previous list inside feed(): cost grew with feeder count
        assertApproxEqRel(big, small, 0.05e18, "revival cost must not scale with old feeder count");

        assertEq(p.generation(), 2);
        assertEq(p.feederListLength(), 1, "new gen starts with a fresh list");
        assertEq(p.feederList(0), alice);
        address[] memory old = p.feedersOfGeneration(1, 0, 5);
        assertEq(old.length, 5, "previous generation's feeders are still readable");
        assertEq(old[0], address(uint160(0x10001)));
    }

    // ── FIX 5: sub-unit metabolism is not lost on frequent calls ───────────

    function test_Fix5_FrequentPokesDoNotSkipMetabolism() public {
        vm.prank(alice);
        pip.feed(1e6, "");
        // poke every 2 seconds for 1 hour: old code burned 0 every time
        for (uint256 i = 0; i < 1800; i++) {
            skip(2);
            pip.poke();
        }
        assertEq(pip.earnings(compute), RATE, "exactly 1 hour of metabolism billed");
        assertEq(pip.balance(), 1e6 - RATE);
    }

    function testFuzz_Fix5_SplitSettlementMatchesSingle(uint256 a, uint256 b) public {
        a = bound(a, 0, 30 days);
        b = bound(b, 0, 30 days);
        vm.prank(alice);
        pip.feed(50e6, "");
        skip(a);
        pip.poke();
        skip(b);
        pip.poke();
        // splitting settlements bills exactly the same as a single settlement
        assertEq(pip.earnings(compute), ((a + b) * RATE) / 3600);
    }

    // ── FIX 6: grave records the real moment of death ──────────────────────

    function test_Fix6_GraveDiedAtIsRealDeathTime() public {
        uint256 t0 = block.timestamp;
        vm.prank(alice);
        pip.feed(10_000, "short life"); // 10 hours at 0.001/h
        skip(5 days); // nobody notices for days
        pip.poke();

        Pip.Grave memory g = pip.getGrave(0);
        assertEq(g.died, t0 + 10 hours, "died when food ran out, not when poked");
        assertEq(pip.earnings(compute), 10_000);
    }
}
