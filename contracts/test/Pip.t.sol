// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {Pip} from "../Pip.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @title Pip.t.sol – comprehensive Foundry tests for Pip.sol
contract PipTest is Test {
    // ─── constants ───────────────────────────────────────────────────────────
    uint256 internal constant BURN_RATE = 20_000; // USDC micros per hour (default)
    uint256 internal constant ONE_USDC  = 1_000_000;

    // default minimum prices (match Pip.sol defaults; owner-adjustable via setPrices)
    // MIN_FEED is used for both feed() (minFeed) and interact(FEED) (minFeedAgent): both 1_000.
    uint256 internal constant MIN_PET      =   100; // 0.0001 USDC
    uint256 internal constant MIN_FEED     = 1_000; // 0.001  USDC
    uint256 internal constant MIN_SAY      =   500; // 0.0005 USDC
    uint256 internal constant MIN_PLAY     = 1_000; // 0.001  USDC
    uint256 internal constant MIN_GIFT_HAT = 5_000; // 0.005  USDC

    // action indices matching enum Action
    uint8 internal constant ACTION_PET      = 0;
    uint8 internal constant ACTION_FEED     = 1;
    uint8 internal constant ACTION_SAY      = 2;
    uint8 internal constant ACTION_PLAY     = 3;
    uint8 internal constant ACTION_GIFT_HAT = 4;

    // ─── actors ──────────────────────────────────────────────────────────────
    address internal owner   = makeAddr("owner");
    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal carol   = makeAddr("carol");
    address internal dave    = makeAddr("dave");
    address internal eve     = makeAddr("eve");
    address internal compute = makeAddr("computeAddress");

    // ─── contracts ───────────────────────────────────────────────────────────
    MockERC20 internal usdc;
    Pip       internal pip;

    // ─── setUp ───────────────────────────────────────────────────────────────
    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        pip  = new Pip(address(usdc), compute, owner, 20_000);

        usdc.mint(alice, 100 * ONE_USDC);
        usdc.mint(bob,   100 * ONE_USDC);
        usdc.mint(carol, 100 * ONE_USDC);
        usdc.mint(dave,  100 * ONE_USDC);
        usdc.mint(eve,   100 * ONE_USDC);

        vm.prank(alice); usdc.approve(address(pip), type(uint256).max);
        vm.prank(bob);   usdc.approve(address(pip), type(uint256).max);
        vm.prank(carol); usdc.approve(address(pip), type(uint256).max);
        vm.prank(dave);  usdc.approve(address(pip), type(uint256).max);
        vm.prank(eve);   usdc.approve(address(pip), type(uint256).max);
    }

    // =========================================================================
    // SECTION 1: DEPLOYMENT & INITIALIZATION
    // =========================================================================

    function test_Constructor_SetsStateCorrectly() public view {
        assertEq(pip.generation(),      1,             "generation should start at 1 after _hatch");
        assertTrue(pip.alive(),                        "should be alive");
        assertEq(pip.balance(),         0,             "balance starts at 0");
        assertEq(pip.USDC(),            address(usdc), "USDC address stored");
        assertEq(pip.computeAddress(),  compute,       "computeAddress stored");
        assertEq(pip.owner(),           owner,         "owner stored");
        assertEq(pip.burnRatePerHour(), BURN_RATE,     "default burn rate");
        assertEq(pip.feederCount(),     0,             "no feeders yet");
        assertEq(pip.totalFedThisGen(), 0,             "totalFed starts at 0");
        assertEq(pip.visitorCount(),    0,             "no visitors yet");
        assertEq(pip.currentHatId(),    0,             "no hat yet");
        assertEq(pip.hatExpiresAt(),    0,             "hat expiry is 0");
    }

    function test_Constructor_EmitsHatched() public {
        vm.expectEmit(true, false, false, true);
        emit Pip.Hatched(1, block.timestamp);
        new Pip(address(usdc), compute, owner, 20_000);
    }

    function test_Constructor_RevertsOnZeroUsdc() public {
        vm.expectRevert(bytes("USDC zero"));
        new Pip(address(0), compute, owner, 20_000);
    }

    function test_Constructor_RevertsOnZeroCompute() public {
        vm.expectRevert(bytes("Compute zero"));
        new Pip(address(usdc), address(0), owner, 20_000);
    }

    function test_Constructor_RevertsOnZeroOwner() public {
        vm.expectRevert(bytes("Owner zero"));
        new Pip(address(usdc), compute, address(0), 20_000);
    }

    // =========================================================================
    // SECTION 2: FEED – happy path
    // =========================================================================

    function test_Feed_HappyPath_BalanceIncreases() public {
        uint256 amount = ONE_USDC;
        uint256 pipBefore   = usdc.balanceOf(address(pip));
        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        pip.feed(amount, "hello pip");

        assertEq(pip.balance(),                  amount,           "pip balance should equal fed amount");
        assertEq(usdc.balanceOf(address(pip)),   pipBefore + amount,   "USDC should move to pip");
        assertEq(usdc.balanceOf(alice),          aliceBefore - amount, "alice USDC decreases");
    }

    function test_Feed_HappyPath_EmitsFed() public {
        uint256 amount = ONE_USDC;
        uint256 expectedTimeLeft = (amount * 3600) / BURN_RATE;

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(pip));
        emit Pip.Fed(1, alice, amount, "hello pip", amount, expectedTimeLeft);
        pip.feed(amount, "hello pip");
    }

    function test_Feed_HappyPath_TimeLeftIncreases() public {
        uint256 tl0 = pip.timeLeft();
        vm.prank(alice);
        pip.feed(ONE_USDC, "");
        assertTrue(pip.timeLeft() > tl0, "timeLeft should increase after feeding");
    }

    function test_Feed_HappyPath_TracksFedByFeeder() public {
        uint256 amount = 50_000;
        vm.prank(alice);
        pip.feed(amount, "");
        assertEq(pip.fedByFeeder(1, alice), amount, "fedByFeeder should track alice's amount");
    }

    function test_Feed_HappyPath_IncrementsFeederCount() public {
        vm.prank(alice);
        pip.feed(MIN_FEED, "");
        assertEq(pip.feederCount(), 1, "feeder count should be 1");

        vm.prank(bob);
        pip.feed(MIN_FEED, "");
        assertEq(pip.feederCount(), 2, "feeder count should be 2");
    }

    function test_Feed_SameFeederNotDoubleCounted() public {
        vm.prank(alice);
        pip.feed(MIN_FEED, "first");
        vm.prank(alice);
        pip.feed(MIN_FEED, "second");

        assertEq(pip.feederCount(), 1,              "alice counted only once");
        assertEq(pip.fedByFeeder(1, alice), MIN_FEED * 2, "alice total accumulates");
    }

    function test_Feed_SetsLastFeederAndNote() public {
        vm.prank(alice);
        pip.feed(MIN_FEED, "note from alice");
        assertEq(pip.lastFeeder(), alice,            "lastFeeder should be alice");
        assertEq(pip.lastNote(),   "note from alice", "lastNote should be set");
    }

    function test_Feed_UpdatesTotalFedThisGen() public {
        vm.prank(alice);
        pip.feed(ONE_USDC, "");
        vm.prank(bob);
        pip.feed(2 * ONE_USDC, "");
        assertEq(pip.totalFedThisGen(), 3 * ONE_USDC, "totalFedThisGen should be sum");
    }

    // ─── feed() minimum (0.01 USDC) ──────────────────────────────────────────
    function test_Feed_AcceptsExactMinimum() public {
        vm.prank(alice);
        pip.feed(MIN_FEED, "");
        assertEq(pip.balance(), MIN_FEED, "balance should equal min feed");
    }

    function test_Feed_RevertsOnBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Amount below minimum"));
        pip.feed(MIN_FEED - 1, "");
    }

    function test_Feed_RevertsOnZero() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Amount below minimum"));
        pip.feed(0, "");
    }

    // ─── feed() note length ───────────────────────────────────────────────────
    function test_Feed_AcceptsExactly80ByteNote() public {
        // 80 'a' characters
        string memory note80 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        // Trim to exactly 80 bytes just in case the literal above varies
        bytes memory nb = bytes(note80);
        assertEq(nb.length, 80, "sanity: exactly 80 bytes");

        vm.prank(alice);
        pip.feed(MIN_FEED, note80); // should not revert
    }

    function test_Feed_RevertsOn81ByteNote() public {
        string memory note81 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        assertEq(bytes(note81).length, 81, "sanity: 81 bytes");

        vm.prank(alice);
        vm.expectRevert(bytes("Note too long"));
        pip.feed(MIN_FEED, note81);
    }

    // =========================================================================
    // SECTION 3: INTERACT – all 5 actions happy path + minimum price
    // =========================================================================

    // ─── helper: interact with exact minimum ─────────────────────────────────
    function _interactMin(address actor, uint8 action, uint8 hatId) internal {
        uint256 min;
        if (action == ACTION_PET)      min = MIN_PET;
        else if (action == ACTION_FEED) min = MIN_FEED;
        else if (action == ACTION_SAY)  min = MIN_SAY;
        else if (action == ACTION_PLAY) min = MIN_PLAY;
        else                           min = MIN_GIFT_HAT;

        vm.prank(actor);
        pip.interact(action, "TestAgent", "", hatId, min);
    }

    // ─── PET ─────────────────────────────────────────────────────────────────
    function test_Interact_Pet_HappyPath_BalanceIncreases() public {
        uint256 before = pip.balance();
        _interactMin(alice, ACTION_PET, 0);
        assertEq(pip.balance(), before + MIN_PET, "balance should increase by MIN_PET");
    }

    function test_Interact_Pet_HappyPath_EmitsInteracted() public {
        // vm.startPrank so the prank persists across the vm.expectEmit call
        vm.startPrank(alice);
        vm.expectEmit(true, true, false, false, address(pip));
        emit Pip.Interacted(pip.generation(), alice, "TestAgent", ACTION_PET, MIN_PET, "", 0, 0);
        pip.interact(ACTION_PET, "TestAgent", "", 0, MIN_PET);
        vm.stopPrank();
    }

    function test_Interact_Pet_AcceptsExactMinimum() public {
        vm.prank(alice);
        pip.interact(ACTION_PET, "A", "", 0, MIN_PET); // should not revert
        assertEq(pip.balance(), MIN_PET);
    }

    function test_Interact_Pet_RevertsBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Amount below minimum"));
        pip.interact(ACTION_PET, "A", "", 0, MIN_PET - 1);
    }

    // ─── FEED (interact) ─────────────────────────────────────────────────────
    function test_Interact_Feed_HappyPath_BalanceIncreases() public {
        uint256 before = pip.balance();
        _interactMin(alice, ACTION_FEED, 0);
        assertEq(pip.balance(), before + MIN_FEED, "balance should increase by MIN_FEED");
    }

    function test_Interact_Feed_AcceptsExactMinimum() public {
        vm.prank(alice);
        pip.interact(ACTION_FEED, "A", "", 0, MIN_FEED);
        assertEq(pip.balance(), MIN_FEED);
    }

    function test_Interact_Feed_RevertsBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Amount below minimum"));
        pip.interact(ACTION_FEED, "A", "", 0, MIN_FEED - 1);
    }

    // ─── SAY ─────────────────────────────────────────────────────────────────
    function test_Interact_Say_HappyPath_BalanceIncreases() public {
        uint256 before = pip.balance();
        _interactMin(alice, ACTION_SAY, 0);
        assertEq(pip.balance(), before + MIN_SAY);
    }

    function test_Interact_Say_AcceptsExactMinimum() public {
        vm.prank(alice);
        pip.interact(ACTION_SAY, "A", "hello", 0, MIN_SAY);
        assertEq(pip.balance(), MIN_SAY);
    }

    function test_Interact_Say_RevertsBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Amount below minimum"));
        pip.interact(ACTION_SAY, "A", "hello", 0, MIN_SAY - 1);
    }

    // ─── PLAY ────────────────────────────────────────────────────────────────
    function test_Interact_Play_HappyPath_BalanceIncreases() public {
        uint256 before = pip.balance();
        _interactMin(alice, ACTION_PLAY, 0);
        assertEq(pip.balance(), before + MIN_PLAY);
    }

    function test_Interact_Play_AcceptsExactMinimum() public {
        vm.prank(alice);
        pip.interact(ACTION_PLAY, "A", "", 0, MIN_PLAY);
        assertEq(pip.balance(), MIN_PLAY);
    }

    function test_Interact_Play_RevertsBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Amount below minimum"));
        pip.interact(ACTION_PLAY, "A", "", 0, MIN_PLAY - 1);
    }

    // ─── GIFT_HAT ────────────────────────────────────────────────────────────
    function test_Interact_GiftHat_HappyPath_BalanceIncreases() public {
        uint256 before = pip.balance();
        _interactMin(alice, ACTION_GIFT_HAT, 1);
        assertEq(pip.balance(), before + MIN_GIFT_HAT);
    }

    function test_Interact_GiftHat_AcceptsExactMinimum() public {
        vm.prank(alice);
        pip.interact(ACTION_GIFT_HAT, "A", "", 1, MIN_GIFT_HAT);
        assertEq(pip.balance(), MIN_GIFT_HAT);
    }

    function test_Interact_GiftHat_RevertsBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Amount below minimum"));
        pip.interact(ACTION_GIFT_HAT, "A", "", 1, MIN_GIFT_HAT - 1);
    }

    // ─── invalid action index ─────────────────────────────────────────────────
    function test_Interact_RevertsOnInvalidAction() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Invalid action"));
        pip.interact(5, "A", "", 0, MIN_PET);
    }

    // =========================================================================
    // SECTION 4: INTERACT – agentName and text length limits
    // =========================================================================

    function test_Interact_AgentName_AcceptsExactly40Bytes() public {
        // exactly 40 'a' chars
        string memory name40 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 40
        assertEq(bytes(name40).length, 40, "sanity: 40 bytes");

        vm.prank(alice);
        pip.interact(ACTION_PET, name40, "", 0, MIN_PET); // should not revert
    }

    function test_Interact_AgentName_RevertsOn41Bytes() public {
        // 41 'a' chars
        string memory name41 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 41
        assertEq(bytes(name41).length, 41, "sanity: 41 bytes");

        vm.prank(alice);
        vm.expectRevert(bytes("Agent name too long"));
        pip.interact(ACTION_PET, name41, "", 0, MIN_PET);
    }

    function test_Interact_Text_AcceptsExactly120Bytes() public {
        // Build a 120-byte string programmatically to avoid count errors in literals
        bytes memory raw = new bytes(120);
        for (uint256 i = 0; i < 120; i++) raw[i] = "x";
        string memory text120 = string(raw);
        assertEq(bytes(text120).length, 120, "sanity: 120 bytes");

        vm.prank(alice);
        pip.interact(ACTION_SAY, "A", text120, 0, MIN_SAY); // should not revert
    }

    function test_Interact_Text_RevertsOn121Bytes() public {
        // Build a 121-byte string programmatically
        bytes memory raw = new bytes(121);
        for (uint256 i = 0; i < 121; i++) raw[i] = "x";
        string memory text121 = string(raw);
        assertEq(bytes(text121).length, 121, "sanity: 121 bytes");

        vm.prank(alice);
        vm.expectRevert(bytes("Text too long"));
        pip.interact(ACTION_SAY, "A", text121, 0, MIN_SAY);
    }

    // =========================================================================
    // SECTION 5: HAT SYSTEM
    // =========================================================================

    function test_Hat_GiftHat_SetsCurrentHatIdAndExpiry() public {
        uint256 ts = block.timestamp;

        vm.prank(alice);
        pip.interact(ACTION_GIFT_HAT, "Alice", "", 3, MIN_GIFT_HAT);

        assertEq(pip.currentHatId(), 3,           "currentHatId should be 3");
        assertEq(pip.hatExpiresAt(), ts + 24 hours, "hatExpiresAt should be 24h from now");
    }

    function test_Hat_CurrentHat_ReturnsActiveStateBeforeExpiry() public {
        vm.prank(alice);
        pip.interact(ACTION_GIFT_HAT, "Alice", "", 2, MIN_GIFT_HAT);

        (uint8 hatId, uint256 expiresAt, bool active) = pip.currentHat();
        assertEq(hatId, 2,                      "hatId should be 2");
        assertEq(expiresAt, block.timestamp + 24 hours, "expiresAt correct");
        assertTrue(active,                      "hat should be active");
    }

    function test_Hat_CurrentHat_ReturnsInactiveAfter25Hours() public {
        vm.prank(alice);
        pip.interact(ACTION_GIFT_HAT, "Alice", "", 1, MIN_GIFT_HAT);

        // Advance 25 hours — past the 24-hour expiry window
        skip(25 hours);

        (uint8 hatId, , bool active) = pip.currentHat();
        assertEq(hatId, 1, "hatId still stored");
        assertFalse(active, "hat should be inactive after 25h");
    }

    function test_Hat_CurrentHat_InactiveWhenHatIdIsZero() public view {
        // No hat gifted yet; hatId == 0 → active == false
        (, , bool active) = pip.currentHat();
        assertFalse(active, "no hat, should be inactive");
    }

    function test_Hat_CurrentHat_ActiveJustBeforeExpiry() public {
        vm.prank(alice);
        pip.interact(ACTION_GIFT_HAT, "Alice", "", 5, MIN_GIFT_HAT);

        // Warp to exactly 1 second before expiry
        skip(24 hours - 1);

        (, , bool active) = pip.currentHat();
        assertTrue(active, "hat should still be active 1s before expiry");
    }

    function test_Hat_GiftHat_InvalidHatIdReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Invalid hatId"));
        pip.interact(ACTION_GIFT_HAT, "A", "", 6, MIN_GIFT_HAT); // hatId > 5
    }

    function test_Hat_GiftHat_AllValidHatIds() public {
        // All hat IDs 1-5 should be accepted
        for (uint8 i = 1; i <= 5; i++) {
            vm.prank(alice);
            pip.interact(ACTION_GIFT_HAT, "A", "", i, MIN_GIFT_HAT);
            assertEq(pip.currentHatId(), i, "hatId should be set");
        }
    }

    function test_Hat_GiftHat_EmitsInteractedWithHatId() public {
        uint256 gen = pip.generation();

        vm.prank(alice);
        vm.expectEmit(true, true, false, false, address(pip));
        emit Pip.Interacted(gen, alice, "Alice", ACTION_GIFT_HAT, MIN_GIFT_HAT, "", 2, 0);
        pip.interact(ACTION_GIFT_HAT, "Alice", "", 2, MIN_GIFT_HAT);
    }

    // =========================================================================
    // SECTION 6: VISITOR TRACKING – visitorCount, unique per address/generation
    // =========================================================================

    function test_Visitor_CountIncrementsOnce_PerUniqueAddress() public {
        // First visit from alice
        _interactMin(alice, ACTION_PET, 0);
        assertEq(pip.visitorCount(), 1, "visitorCount should be 1 after alice");

        // Second visit from alice — no increment
        _interactMin(alice, ACTION_SAY, 0);
        assertEq(pip.visitorCount(), 1, "visitorCount should still be 1");

        // First visit from bob
        _interactMin(bob, ACTION_PET, 0);
        assertEq(pip.visitorCount(), 2, "visitorCount should be 2 after bob");
    }

    function test_Visitor_TotalSpentAccumulatesAcrossMultipleInteractions() public {
        vm.prank(alice);
        pip.interact(ACTION_PET, "Alice", "", 0, MIN_PET);
        vm.prank(alice);
        pip.interact(ACTION_PLAY, "Alice", "", 0, MIN_PLAY);

        uint256 gen = pip.generation();
        (address w, , uint256 total,) = pip.visitors(gen, alice);
        assertEq(w,     alice,              "wallet stored correctly");
        assertEq(total, MIN_PET + MIN_PLAY, "totalSpent should accumulate");
    }

    function test_Visitor_LastVisitorNameSetAfterInteract() public {
        vm.prank(alice);
        pip.interact(ACTION_PET, "CuteBot", "", 0, MIN_PET);

        assertEq(pip.lastVisitorWallet(), alice,     "lastVisitorWallet should be alice");
        assertEq(pip.lastVisitorName(),   "CuteBot", "lastVisitorName should be set");
    }

    function test_Visitor_LastVisitorNameUpdatedByMostRecent() public {
        _interactMin(alice, ACTION_PET, 0); // alice visits first

        vm.prank(bob);
        pip.interact(ACTION_PET, "BobAgent", "", 0, MIN_PET);

        assertEq(pip.lastVisitorWallet(), bob,       "lastVisitorWallet should be bob");
        assertEq(pip.lastVisitorName(),   "BobAgent", "lastVisitorName should be bob's");
    }

    // ─── visitorCount resets on death-and-feed (new generation via _hatch) ──
    function _killPip() internal {
        // Feed enough to keep alive, then warp far past balance exhaustion
        vm.prank(alice);
        pip.feed(ONE_USDC, "");
        // burnRatePerHour = 20_000 micro USDC/hr
        // time to drain 1_000_000 = 1_000_000 / 20_000 = 50 hours + 1s
        skip(51 hours);
        // poke triggers _settle which marks it dead
        pip.poke();
        assertFalse(pip.alive(), "pip should be dead after 51h drain");
    }

    function test_Visitor_CountResetsOnHatchViaFeed() public {
        _interactMin(alice, ACTION_PET, 0);
        _interactMin(bob,   ACTION_PET, 0);
        assertEq(pip.visitorCount(), 2, "two visitors before death");

        _killPip();

        // feed() on dead pip triggers _hatch → new generation
        vm.prank(carol);
        pip.feed(MIN_FEED, "revive");

        assertEq(pip.visitorCount(), 0, "visitorCount should reset after new hatch");
        assertEq(pip.generation(),   2, "should be gen 2");
    }

    function test_Visitor_CountResetsOnHatchViaInteract() public {
        _interactMin(alice, ACTION_PET, 0);
        assertEq(pip.visitorCount(), 1, "one visitor before death");

        _killPip();

        // interact() on dead pip also triggers _hatch
        vm.prank(bob);
        pip.interact(ACTION_PET, "BobReviver", "", 0, MIN_PET);

        // After hatch, bob is the first visitor of the new gen
        assertEq(pip.visitorCount(), 1, "only bob in new generation");
        assertEq(pip.generation(),   2, "should be gen 2");
    }

    function test_Visitor_OldGenerationDataPreserved() public {
        _interactMin(alice, ACTION_PET, 0);
        uint256 gen1 = pip.generation();
        (address stored, , ,) = pip.visitors(gen1, alice);
        assertEq(stored, alice, "alice's gen-1 visitor record preserved");

        _killPip();
        vm.prank(bob);
        pip.feed(MIN_FEED, "revive");

        // alice's gen-1 record still intact after new generation
        (address still, , ,) = pip.visitors(gen1, alice);
        assertEq(still, alice, "alice's gen-1 record unaffected by new hatch");
    }

    // =========================================================================
    // SECTION 7: EPITAPH – lastVisitorName vs lastNote
    // =========================================================================

    function test_Epitaph_UsesLastVisitorNameWhenSet() public {
        // Seed balance then let visitor interact
        vm.prank(alice);
        pip.feed(ONE_USDC, "feeding note");

        vm.prank(bob);
        pip.interact(ACTION_PET, "BobAgent", "", 0, MIN_PET);

        // Now drain the pip
        skip(51 hours);
        pip.poke();

        assertFalse(pip.alive(), "pip should be dead");

        // Grave epitaph should use lastVisitorName
        uint256 graveIdx = pip.gravesCount() - 1;
        Pip.Grave memory g = pip.getGrave(graveIdx);
        assertEq(g.epitaph, "last visited by BobAgent", "epitaph should use lastVisitorName");
    }

    function test_Epitaph_FallsBackToLastNoteWhenNoVisitor() public {
        vm.prank(alice);
        pip.feed(ONE_USDC, "farewell note");

        skip(51 hours);
        pip.poke();

        assertFalse(pip.alive(), "pip should be dead");

        uint256 graveIdx = pip.gravesCount() - 1;
        Pip.Grave memory g = pip.getGrave(graveIdx);
        assertEq(g.epitaph, "farewell note", "epitaph should fall back to lastNote");
    }

    function test_Epitaph_UsesDefaultWhenNoNoteAndNoVisitor() public {
        vm.prank(alice);
        pip.feed(ONE_USDC, "");

        skip(51 hours);
        pip.poke();

        uint256 graveIdx = pip.gravesCount() - 1;
        Pip.Grave memory g = pip.getGrave(graveIdx);
        assertEq(g.epitaph, "pip ran out of compute. rip.", "should use default epitaph");
    }

    function test_Epitaph_LastVisitorNameTakesPriorityOverLastNote() public {
        vm.prank(alice);
        pip.feed(ONE_USDC, "alice's note");

        // Bob visits AFTER alice's note — lastVisitorName takes priority
        vm.prank(bob);
        pip.interact(ACTION_SAY, "BobSpeaks", "hi", 0, MIN_SAY);

        skip(51 hours);
        pip.poke();

        uint256 graveIdx = pip.gravesCount() - 1;
        Pip.Grave memory g = pip.getGrave(graveIdx);
        assertEq(g.epitaph, "last visited by BobSpeaks", "lastVisitorName takes priority over lastNote");
    }

    // =========================================================================
    // SECTION 8: topVisitors() – ordering by totalSpent
    // =========================================================================

    function test_TopVisitors_SingleVisitor() public {
        vm.prank(alice);
        pip.interact(ACTION_PLAY, "Alice", "", 0, MIN_PLAY);

        (address[5] memory addrs, string[5] memory names, uint256[5] memory amounts) = pip.topVisitors();
        assertEq(addrs[0],   alice,    "top visitor should be alice");
        assertEq(names[0],   "Alice",  "name should be Alice");
        assertEq(amounts[0], MIN_PLAY, "amount should be MIN_PLAY");
        assertEq(addrs[1],   address(0), "second slot should be empty");
    }

    function test_TopVisitors_OrderedByTotalSpentDescending() public {
        // alice spends 3 * MIN_PLAY, bob spends 2 * MIN_PLAY, carol spends 1 * MIN_PLAY
        vm.prank(alice);
        pip.interact(ACTION_PLAY, "Alice", "", 0, 3 * MIN_PLAY);

        vm.prank(bob);
        pip.interact(ACTION_PLAY, "Bob", "", 0, 2 * MIN_PLAY);

        vm.prank(carol);
        pip.interact(ACTION_PLAY, "Carol", "", 0, 1 * MIN_PLAY);

        (address[5] memory addrs, string[5] memory names, uint256[5] memory amounts) = pip.topVisitors();
        assertEq(addrs[0], alice, "1st should be alice");
        assertEq(addrs[1], bob,   "2nd should be bob");
        assertEq(addrs[2], carol, "3rd should be carol");

        assertEq(names[0],   "Alice", "name[0] should be Alice");
        assertEq(names[1],   "Bob",   "name[1] should be Bob");
        assertEq(names[2],   "Carol", "name[2] should be Carol");

        assertEq(amounts[0], 3 * MIN_PLAY, "amounts[0] correct");
        assertEq(amounts[1], 2 * MIN_PLAY, "amounts[1] correct");
        assertEq(amounts[2], 1 * MIN_PLAY, "amounts[2] correct");
    }

    function test_TopVisitors_AccumulatesMultipleInteractionsPerVisitor() public {
        // bob visits three times; alice once with a bigger total
        vm.prank(bob);
        pip.interact(ACTION_PET, "Bob", "", 0, MIN_PET);
        vm.prank(bob);
        pip.interact(ACTION_SAY, "Bob", "", 0, MIN_SAY);

        vm.prank(alice);
        pip.interact(ACTION_PLAY, "Alice", "", 0, MIN_PLAY); // 1_000

        // bob total = 100 + 500 = 600; alice total = 1_000
        (address[5] memory addrs, , uint256[5] memory amounts) = pip.topVisitors();
        assertEq(addrs[0],   alice,              "alice should be #1");
        assertEq(amounts[0], MIN_PLAY,            "alice amount correct");
        assertEq(addrs[1],   bob,                 "bob should be #2");
        assertEq(amounts[1], MIN_PET + MIN_SAY,   "bob accumulated amount correct");
    }

    function test_TopVisitors_UpToFiveSlots() public {
        // 6 visitors — only top-5 should appear
        address[6] memory actors;
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = carol;
        actors[3] = dave;
        actors[4] = eve;
        // create a 6th actor and fund them
        address sixth = makeAddr("sixth");
        actors[5] = sixth;
        usdc.mint(sixth, 100 * ONE_USDC);
        vm.prank(sixth); usdc.approve(address(pip), type(uint256).max);

        // Each spends a different amount so ordering is deterministic
        for (uint256 i = 0; i < 6; i++) {
            uint256 amount = (6 - i) * MIN_PLAY; // 6,5,4,3,2,1 * MIN_PLAY
            vm.prank(actors[i]);
            pip.interact(ACTION_PLAY, string(abi.encodePacked("A", i)), "", 0, amount);
        }

        (address[5] memory addrs, , uint256[5] memory amounts) = pip.topVisitors();

        // alice (i=0) spent 6*MIN_PLAY (most), sixth (i=5) spent 1*MIN_PLAY (least)
        // top-5 should be alice,bob,carol,dave,eve
        assertEq(addrs[0], alice, "slot 0 = alice");
        assertEq(addrs[1], bob,   "slot 1 = bob");
        assertEq(addrs[2], carol, "slot 2 = carol");
        assertEq(addrs[3], dave,  "slot 3 = dave");
        assertEq(addrs[4], eve,   "slot 4 = eve");

        // sixth did NOT make the top-5
        for (uint256 j = 0; j < 5; j++) {
            assertTrue(addrs[j] != sixth, "sixth should NOT appear in top-5");
        }

        // amounts descending
        assertEq(amounts[0], 6 * MIN_PLAY, "amounts[0]");
        assertEq(amounts[1], 5 * MIN_PLAY, "amounts[1]");
        assertEq(amounts[2], 4 * MIN_PLAY, "amounts[2]");
        assertEq(amounts[3], 3 * MIN_PLAY, "amounts[3]");
        assertEq(amounts[4], 2 * MIN_PLAY, "amounts[4]");
    }

    function test_TopVisitors_EmptyWhenNoVisitors() public view {
        (address[5] memory addrs, , uint256[5] memory amounts) = pip.topVisitors();
        for (uint256 i = 0; i < 5; i++) {
            assertEq(addrs[i],   address(0), "addrs should be zero");
            assertEq(amounts[i], 0,          "amounts should be zero");
        }
    }

    // =========================================================================
    // SECTION 9: INTERACT REVIVES DEAD PIP (same as feed does)
    // =========================================================================

    function test_Interact_RevivesDeadPip_NewGeneration() public {
        uint256 gen1 = pip.generation();
        _killPip();
        assertFalse(pip.alive(), "pip is dead");

        // interact() on dead pip should revive (hatch new gen)
        vm.prank(bob);
        pip.interact(ACTION_PET, "BobReviver", "", 0, MIN_PET);

        assertTrue(pip.alive(),                         "pip should be alive again");
        assertEq(pip.generation(), gen1 + 1,            "generation should increment");
    }

    function test_Interact_RevivesDeadPip_StateReset() public {
        // Build up state in gen 1 (visitors, hat), then kill pip via a plain
        // excessive-time drain so the exact balance is predictable.

        // Gen-1 state: alice visits and gifts a hat
        _interactMin(alice, ACTION_PET, 0);
        vm.prank(alice);
        pip.interact(ACTION_GIFT_HAT, "Alice", "", 3, MIN_GIFT_HAT);

        // Kill by draining: total balance in pip after the two interacts above is
        // MIN_PET + MIN_GIFT_HAT = 51_000 micros.
        // At 20_000/hr that drains in 51_000/20_000 * 3600 ≈ 9_180s < 3h.
        // Warp 4h to be safe.
        skip(4 hours);
        pip.poke();
        assertFalse(pip.alive(), "pip should be dead after 4h on 51_000 balance");

        // Revive via interact — bob is the first visitor of the new gen
        vm.prank(bob);
        pip.interact(ACTION_PET, "BobReviver", "", 0, MIN_PET);

        // All generation-specific state should be reset
        assertEq(pip.visitorCount(),    1,       "only bob is a visitor in new gen");
        assertEq(pip.feederCount(),     0,       "feederCount reset");
        assertEq(pip.totalFedThisGen(), MIN_PET, "only bob's PET amount");
        assertEq(pip.currentHatId(),    0,       "hat cleared on hatch");
        assertEq(pip.hatExpiresAt(),    0,       "hat expiry cleared on hatch");
    }

    function test_Interact_RevivesDeadPip_EmitsHatched() public {
        _killPip();
        uint256 gen1 = pip.generation();

        vm.prank(bob);
        vm.expectEmit(true, false, false, false, address(pip));
        emit Pip.Hatched(gen1 + 1, block.timestamp);
        pip.interact(ACTION_PET, "Bob", "", 0, MIN_PET);
    }

    function test_Feed_RevivesDeadPip_NewGeneration() public {
        uint256 gen1 = pip.generation();
        _killPip();

        vm.prank(carol);
        pip.feed(MIN_FEED, "reviving carol");

        assertTrue(pip.alive(),                "pip should be alive after feed revive");
        assertEq(pip.generation(), gen1 + 1,   "generation should increment");
    }

    function test_Feed_RevivesDeadPip_EmitsHatched() public {
        _killPip();
        uint256 gen1 = pip.generation();

        vm.prank(carol);
        vm.expectEmit(true, false, false, false, address(pip));
        emit Pip.Hatched(gen1 + 1, block.timestamp);
        pip.feed(MIN_FEED, "reviving carol");
    }

    // =========================================================================
    // SECTION 10: INTERACT – totalFedThisGen increments
    // =========================================================================

    function test_Interact_IncrementsTotalFedThisGen() public {
        vm.prank(alice);
        pip.interact(ACTION_PET,  "A", "", 0, MIN_PET);
        vm.prank(bob);
        pip.interact(ACTION_PLAY, "B", "", 0, MIN_PLAY);

        assertEq(pip.totalFedThisGen(), MIN_PET + MIN_PLAY, "totalFedThisGen tracks interact amounts");
    }

    // =========================================================================
    // SECTION 11: INTERACT – isAlive() / poke() integration
    // =========================================================================

    function test_IsAlive_ReturnsTrueAfterFeed() public {
        vm.prank(alice);
        pip.feed(ONE_USDC, "");
        assertTrue(pip.isAlive(), "pip should be alive after feed");
    }

    function test_IsAlive_ReturnsFalseAfterDrain() public {
        _killPip();
        assertFalse(pip.isAlive(), "pip should be dead after drain");
    }

    function test_Poke_TriggersSettleAndCanKill() public {
        vm.prank(alice);
        pip.feed(ONE_USDC, "");
        skip(51 hours);
        pip.poke();
        assertFalse(pip.alive(), "poke should trigger death after sufficient time");
    }

    // =========================================================================
    // SECTION 12: setBurnRate – access control
    // =========================================================================

    function test_SetBurnRate_OwnerCanChange() public {
        vm.prank(owner);
        pip.setBurnRate(50_000);
        assertEq(pip.burnRatePerHour(), 50_000, "burn rate should update");
    }

    function test_SetBurnRate_RevertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Not owner"));
        pip.setBurnRate(50_000);
    }

    function test_SetBurnRate_RevertsOnTooLow() public {
        vm.prank(owner);
        vm.expectRevert(bytes("Rate out of bounds"));
        pip.setBurnRate(999);
    }

    function test_SetBurnRate_RevertsOnTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(bytes("Rate out of bounds"));
        pip.setBurnRate(200_001);
    }

    function test_SetBurnRate_AcceptsBounds() public {
        vm.prank(owner);
        pip.setBurnRate(1_000);
        assertEq(pip.burnRatePerHour(), 1_000, "lower bound accepted");

        vm.prank(owner);
        pip.setBurnRate(200_000);
        assertEq(pip.burnRatePerHour(), 200_000, "upper bound accepted");
    }

    // =========================================================================
    // SECTION 13: transferOwnership
    // =========================================================================

    function test_TransferOwnership_HappyPath() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(pip));
        emit Pip.OwnershipTransferred(owner, alice);
        pip.transferOwnership(alice);
        assertEq(pip.owner(), alice, "new owner should be alice");
    }

    function test_TransferOwnership_RevertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Not owner"));
        pip.transferOwnership(bob);
    }

    function test_TransferOwnership_RevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(bytes("Owner zero"));
        pip.transferOwnership(address(0));
    }

    // =========================================================================
    // SECTION 14: FUZZ – interact amount boundaries
    // =========================================================================

    function testFuzz_Interact_Pet_AcceptsAboveMinimum(uint256 extra) public {
        extra = bound(extra, 0, ONE_USDC);
        uint256 amount = MIN_PET + extra;
        // Make sure alice has enough
        usdc.mint(alice, amount);
        vm.prank(alice);
        pip.interact(ACTION_PET, "Fuzzer", "", 0, amount);
        // Just check balance went up — exact match may drift due to burn calc
        assertTrue(pip.balance() >= amount, "balance should include fuzz amount");
    }

    function testFuzz_Interact_GiftHat_ValidHatIds(uint8 hatId) public {
        hatId = uint8(bound(uint256(hatId), 1, 5));
        vm.prank(alice);
        pip.interact(ACTION_GIFT_HAT, "Fuzzer", "", hatId, MIN_GIFT_HAT);
        assertEq(pip.currentHatId(), hatId, "hatId should be stored");
    }

    function testFuzz_Feed_RejectsAmountBelowMin(uint256 amount) public {
        amount = bound(amount, 0, MIN_FEED - 1);
        vm.prank(alice);
        vm.expectRevert(bytes("Amount below minimum"));
        pip.feed(amount, "");
    }

    // =========================================================================
    // SECTION 15: GRAVES
    // =========================================================================

    function test_Graves_RecordedOnDeath() public {
        vm.prank(alice);
        pip.feed(ONE_USDC, "alice final note");

        assertEq(pip.gravesCount(), 0, "no graves yet");

        skip(51 hours);
        pip.poke();

        assertEq(pip.gravesCount(), 1, "one grave after death");
        Pip.Grave memory g = pip.getGrave(0);
        assertEq(g.gen,      1,          "grave gen = 1");
        assertEq(g.totalFed, ONE_USDC,   "totalFed correct");
        assertEq(g.feeders,  1,          "one feeder");
        assertEq(g.lastFeeder, alice,    "lastFeeder = alice");
    }

    function test_Graves_MultipleGenerations() public {
        // Kill gen 1
        vm.prank(alice);
        pip.feed(ONE_USDC, "");
        skip(51 hours);
        pip.poke();

        // Revive → kill gen 2
        vm.prank(bob);
        pip.feed(ONE_USDC, "");
        skip(51 hours);
        pip.poke();

        assertEq(pip.gravesCount(), 2, "should have 2 graves");
        assertEq(pip.getGrave(0).gen, 1, "first grave = gen 1");
        assertEq(pip.getGrave(1).gen, 2, "second grave = gen 2");
    }

    // =========================================================================
    // SECTION 16: mood()
    // =========================================================================

    function test_Mood_ReturnsFiveWhenDead() public {
        // No funds, pip is alive but has 0 balance → isAlive() == false
        assertEq(pip.mood(), 5, "mood 5 when dead/starving");
    }

    function test_Mood_ReturnsMoodBasedOnTimeLeft() public {
        // Feed enough for > 72h: 72 * 20_000 = 1_440_000 micros + buffer
        vm.prank(alice);
        pip.feed(2 * ONE_USDC, ""); // 2_000_000 / 20_000 = 100h
        assertEq(pip.mood(), 0, "mood 0 when > 72h left");
    }

    // =========================================================================
    // SECTION 17: setComputeAddress – access control, settle, event, routing
    // =========================================================================

    /// @dev Happy path: owner calls setComputeAddress, pending metabolism is settled
    ///      to the OLD address, then the new address is stored and the event is emitted.
    function test_SetComputeAddress_HappyPath_SettlesToOldAddressAndSwitches() public {
        address newCompute = makeAddr("newCompute");

        // Feed pip so there is a balance to burn, then advance time so
        // pending metabolism accrues to `compute` (the original address).
        vm.prank(alice);
        pip.feed(ONE_USDC, "");

        // Advance 10 hours: burned = 10 * 20_000 = 200_000 micros should flow to OLD compute
        skip(10 hours);

        uint256 oldComputeBefore = usdc.balanceOf(compute);
        uint256 newComputeBefore = usdc.balanceOf(newCompute);

        // Expect the ComputeAddressChanged event
        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(pip));
        emit Pip.ComputeAddressChanged(compute, newCompute);
        pip.setComputeAddress(newCompute);

        // The settle inside setComputeAddress CREDITED ~200_000 to OLD compute (pull-payment);
        // the old address (or anyone on its behalf) withdraws it.
        pip.withdrawEarnings(compute);
        uint256 burned10h = (10 hours * BURN_RATE) / 3600;
        assertEq(
            usdc.balanceOf(compute),
            oldComputeBefore + burned10h,
            "pending metabolism should go to OLD compute address"
        );
        // New compute address has not received anything yet
        assertEq(usdc.balanceOf(newCompute), newComputeBefore, "new compute should have nothing yet");

        // State updated
        assertEq(pip.computeAddress(), newCompute, "computeAddress should be newCompute");
    }

    /// @dev Revert: non-owner cannot call setComputeAddress.
    function test_SetComputeAddress_RevertsForNonOwner() public {
        address newCompute = makeAddr("newCompute");
        vm.prank(alice);
        vm.expectRevert(bytes("Not owner"));
        pip.setComputeAddress(newCompute);
    }

    /// @dev Revert: zero address is rejected.
    function test_SetComputeAddress_RevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(bytes("Compute zero"));
        pip.setComputeAddress(address(0));
    }

    /// @dev After the switch, newly burned USDC flows to the NEW compute address.
    function test_SetComputeAddress_AfterSwitch_NewBurnGoesToNewAddress() public {
        address newCompute = makeAddr("newCompute");

        // Give pip a balance then switch compute address immediately (no time elapsed,
        // so nothing is settled to old address yet).
        vm.prank(alice);
        pip.feed(ONE_USDC, "");

        // Switch while pip is alive (no elapsed time → 0 burned to old)
        vm.prank(owner);
        pip.setComputeAddress(newCompute);

        uint256 newComputeBefore = usdc.balanceOf(newCompute);

        // Now advance 5 hours: burn = 5 * 20_000 = 100_000 micros should go to newCompute
        skip(5 hours);
        pip.poke(); // triggers _settle, credits burned amount to computeAddress (newCompute)
        pip.withdrawEarnings(newCompute);

        uint256 burned5h = (5 hours * BURN_RATE) / 3600;
        assertEq(
            usdc.balanceOf(newCompute),
            newComputeBefore + burned5h,
            "burned USDC after switch should go to new compute address"
        );
    }

    // =========================================================================
    // SECTION 18: _initialBurnRate constructor parameter
    // =========================================================================

    /// @dev Custom burn rate is stored from constructor parameter.
    function test_Constructor_InitialBurnRate_StoredCorrectly() public {
        Pip customPip = new Pip(address(usdc), compute, owner, 5_000);
        assertEq(customPip.burnRatePerHour(), 5_000, "burnRatePerHour should be 5_000 as passed to constructor");
    }

    /// @dev Below-minimum burn rate (999) reverts at construction.
    function test_Constructor_InitialBurnRate_RevertsOnBelowMin() public {
        vm.expectRevert(bytes("Rate out of bounds"));
        new Pip(address(usdc), compute, owner, 999);
    }

    /// @dev Above-maximum burn rate (200_001) reverts at construction.
    function test_Constructor_InitialBurnRate_RevertsOnAboveMax() public {
        vm.expectRevert(bytes("Rate out of bounds"));
        new Pip(address(usdc), compute, owner, 200_001);
    }

    /// @dev After death + rebirth the burn rate is still the constructor value,
    ///      not reset to 20_000 or any hardcoded default.
    function test_Constructor_InitialBurnRate_PreservedAcrossGenerations() public {
        // Deploy with a non-default rate
        uint256 customRate = 5_000;
        Pip customPip = new Pip(address(usdc), compute, owner, customRate);

        // Fund and approve for customPip
        usdc.mint(alice, 10 * ONE_USDC);
        vm.prank(alice);
        usdc.approve(address(customPip), type(uint256).max);

        // Feed once so there is balance, then drain it
        vm.prank(alice);
        customPip.feed(ONE_USDC, "");

        // At 5_000/hr, 1_000_000 drains in 200h; warp 201h
        skip(201 hours);
        customPip.poke();
        assertFalse(customPip.alive(), "customPip should be dead after 201h");

        // Revive (new generation)
        vm.prank(alice);
        customPip.feed(MIN_FEED, "revive");
        assertTrue(customPip.alive(), "customPip should be alive after revive");
        assertEq(customPip.generation(), 2, "should be gen 2");

        // Burn rate must still be 5_000, not reset to 20_000
        assertEq(
            customPip.burnRatePerHour(),
            customRate,
            "burnRatePerHour must remain at constructor value after rebirth, not reset to 20_000"
        );
    }

    // =========================================================================
    // SECTION N: CONSTRUCTOR _owner PARAMETER
    // =========================================================================

    /// @dev Deploying with a specific owner stores that exact address in pip.owner().
    function test_constructor_ownerIsSet() public {
        address customOwner = makeAddr("customOwner");
        Pip localPip = new Pip(address(usdc), compute, customOwner, 20_000);
        assertEq(localPip.owner(), customOwner, "owner() must equal the address passed to constructor");
    }

    /// @dev When the deployer (address(this)) is NOT the owner argument,
    ///      pip.owner() returns the passed address, not the deployer.
    function test_constructor_ownerNotDeployer() public {
        address customOwner = makeAddr("customOwner2");
        // address(this) is the test contract — it is the deployer but NOT the owner argument.
        assertTrue(customOwner != address(this), "pre-condition: customOwner != deployer");
        Pip localPip = new Pip(address(usdc), compute, customOwner, 20_000);
        assertEq(localPip.owner(), customOwner, "stored owner must be the passed address, not the deployer");
        assertTrue(localPip.owner() != address(this), "deployer must NOT be owner");
    }

    /// @dev When a custom owner was supplied, the deployer (address(this)) is rejected
    ///      by setBurnRate with "Not owner".
    function test_setBurnRate_onlyPassedOwner() public {
        address customOwner = makeAddr("customOwner3");
        Pip localPip = new Pip(address(usdc), compute, customOwner, 20_000);

        // The deployer (test contract = address(this)) must be rejected.
        vm.expectRevert(bytes("Not owner"));
        localPip.setBurnRate(50_000);

        // The designated owner can call it successfully.
        vm.prank(customOwner);
        localPip.setBurnRate(50_000);
        assertEq(localPip.burnRatePerHour(), 50_000, "burnRatePerHour should update after owner call");
    }

    /// @dev When a custom owner was supplied, the deployer (address(this)) is rejected
    ///      by setComputeAddress with "Not owner".
    function test_setComputeAddress_onlyPassedOwner() public {
        address customOwner = makeAddr("customOwner4");
        Pip localPip = new Pip(address(usdc), compute, customOwner, 20_000);
        address newCompute = makeAddr("newCompute");

        // The deployer (test contract = address(this)) must be rejected.
        vm.expectRevert(bytes("Not owner"));
        localPip.setComputeAddress(newCompute);

        // The designated owner can call it successfully.
        vm.prank(customOwner);
        localPip.setComputeAddress(newCompute);
        assertEq(localPip.computeAddress(), newCompute, "computeAddress should update after owner call");
    }
}
