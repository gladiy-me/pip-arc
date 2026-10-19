// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {PipWorld} from "../PipWorld.sol";
import {PipWorldVault} from "../PipWorldVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract SomeContract {}

/// Audit round 2 regressions (see docs/AUDIT_ROUND2.md)
contract AuditRound2Test is Test {
    MockERC20 usdc;
    PipWorld world;
    PipWorldVault vault;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        world = new PipWorld(address(usdc), makeAddr("compute"), owner, 42 days);
        vault = PipWorldVault(world.vault());
        _fund(alice);
    }

    function _fund(address a) internal {
        usdc.mint(a, 100e6);
        vm.prank(a);
        usdc.approve(address(world), type(uint256).max);
    }

    function _friends(uint256 food) internal returns (address[] memory fs) {
        fs = new address[](8);
        for (uint256 i = 0; i < 8; i++) {
            fs[i] = address(uint160(0x5B11 + i));
            _fund(fs[i]);
            vm.prank(fs[i]);
            world.hatch("s", food);
        }
    }

    function _visitAll(address[] memory fs, uint256 id) internal returns (uint256 visitors) {
        for (uint256 i = 0; i < fs.length; i++) {
            vm.prank(fs[i]);
            world.interact(id, 0, "", "", 0, 100);
        }
        (PipWorld.Pet memory p,,,,,,) = world.petView(id);
        visitors = p.visitors;
    }

    // A-1 fixed: dead sybil pips are not friends
    function test_A1_DeadPipsAreNotFriends() public {
        address[] memory fs = _friends(50_000); // starve after 50h
        skip(4 days);
        vm.prank(alice);
        uint256 id = world.hatch("alice", 10e6);
        assertEq(_visitAll(fs, id), 0);
    }

    function test_A1_LivingOldPipsAreFriends() public {
        address[] memory fs = _friends(5e6); // ~208 days of mochi food
        skip(3 days);
        vm.prank(alice);
        uint256 id = world.hatch("alice", 10e6);
        assertEq(_visitAll(fs, id), 8);
    }

    function test_A1_FriendWhosePipDiedLaterStillCountedOnce() public {
        address[] memory fs = _friends(80_000); // 80h of food
        skip(3 days); // 72h: alive and old enough
        vm.prank(alice);
        uint256 id = world.hatch("alice", 10e6);
        assertEq(_visitAll(fs, id), 8, "counted while alive");
        skip(1 days); // they die
        assertEq(_visitAll(fs, id), 8, "already counted, not removed, not double counted");
    }

    // A-2: owner can renounce the launch path forever; the vault becomes a food bank at once
    function test_A2_RenounceLaunchIsPermanent() public {
        vm.prank(owner);
        vault.renounceLaunch();
        assertTrue(vault.launchRenounced());
        assertTrue(vault.inFoodBankMode());
        address target = address(new SomeContract());
        vm.prank(owner);
        vm.expectRevert(bytes("Launch renounced"));
        vault.proposeLaunch(target);
    }

    function test_A2_RenounceAlsoKillsAPendingProposal() public {
        address target = address(new SomeContract());
        vm.startPrank(owner);
        vault.proposeLaunch(target);
        vault.renounceLaunch();
        skip(14 days);
        vm.expectRevert(bytes("Nothing pending"));
        vault.executeLaunch();
        vm.stopPrank();
    }

    function test_A2_FoodBankWorksRightAfterRenounce() public {
        vm.prank(alice);
        uint256 id = world.hatch("alice", 1e6);
        skip(300 hours);
        world.poke(id);
        vm.prank(owner);
        vault.renounceLaunch();
        vault.feedPet(id);
        assertEq(vault.lastFoodBankMeal(id), block.timestamp);
    }

    // tokenURI is base64 JSON
    function test_TokenURIIsBase64Json() public {
        vm.prank(alice);
        uint256 id = world.hatch("mo #1 % <ok>", 50_000);
        string memory json = string.concat(
            '{"name":"mo #1 % <ok>","description":"a pip from pip.exe, season 1",',
            '"attributes":[{"trait_type":"stage","value":"mochi"},{"trait_type":"status","value":"alive"},',
            '{"trait_type":"meals","value":0},{"trait_type":"friends","value":0},',
            '{"trait_type":"line depth","value":1}]}'
        );
        assertEq(world.tokenURI(id), string.concat("data:application/json;base64,", Base64.encode(bytes(json))));
    }
}
