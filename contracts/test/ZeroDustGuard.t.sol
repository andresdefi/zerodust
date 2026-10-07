// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

interface IZeroDustGuard {
    function sweep(address target, uint256 fee, bytes calldata data) external payable;
}

/// @dev A bridge-like target: logs, writes storage, takes value
contract DepositTarget {
    uint256 public deposits;
    event Deposit(address indexed from, uint256 value, bytes data);

    fallback() external payable {
        deposits += 1;
        emit Deposit(msg.sender, msg.value, msg.data);
    }
}

/// @dev Sends 1 wei back to the sweeping wallet (a refund would leave dust)
contract RefundingTarget {
    address public immutable wallet;
    constructor(address w) payable { wallet = w; }
    receive() external payable { payable(wallet).transfer(1); }
    fallback() external payable {
        payable(wallet).transfer(1);
    }
}

contract RevertingTarget {
    fallback() external payable { revert("no"); }
}

/**
 * ZeroDustGuard (src/ZeroDustGuard.yul). The burn is checked by its slope: called with gas g, the
 * caller spends g + a constant exactly when the guard leaves no gas unused, for every g (the tail
 * loops in 30-gas laps, so g runs over every residue). Real transactions with the chain's gas
 * purchase and refund are checked end to end in script/guard-exact-zero.mjs.
 */
contract ZeroDustGuardTest is Test {
    address constant ZERODUST = 0x01eD5c94DE39E73C986b98B85C2c0A3d1BEDff7D;
    IZeroDustGuard guard;
    address wallet = makeAddr("wallet");
    address recipient = makeAddr("recipient");

    function setUp() public {
        bytes memory code = vm.parseJsonBytes(vm.readFile("out/ZeroDustGuard.yul/ZeroDustGuard.json"), ".bytecode.object");
        address g;
        assembly { g := create(0, add(code, 0x20), mload(code)) }
        require(g != address(0), "deploy");
        guard = IZeroDustGuard(g);
    }

    /// Gas the bare CALL cost the caller (measured in assembly around the call alone, so memory the
    /// test allocates never enters it; the CALL's own overhead is the same every time)
    function spend(address target, uint256 value, uint256 fee, bytes memory data, uint256 g) internal returns (uint256 used, bool ok) {
        return spendAt(address(guard), target, value, fee, data, g);
    }

    function spendAt(address to, address target, uint256 value, uint256 fee, bytes memory data, uint256 g) internal returns (uint256 used, bool ok) {
        bytes memory cd = abi.encodeCall(IZeroDustGuard.sweep, (target, fee, data));
        vm.deal(wallet, value);
        vm.prank(wallet);
        assembly {
            let before := gas()
            ok := call(g, to, value, add(cd, 0x20), mload(cd), 0, 0)
            used := sub(before, gas())
        }
    }

    function test_burnsEveryUnitOfGas_plainRecipient() public {
        // Warm-up calls (cold access is charged once), then the reference: the first measured lap
        spend(recipient, 1 ether, 0.01 ether, "", 100_000);
        spend(recipient, 1 ether, 0.01 ether, "", 100_000);
        // The reference is taken inside the same loop: the compiler inlines spend() differently at
        // each call site, which would shift a measurement taken elsewhere by a few gas
        uint256 overhead;
        for (uint256 i = 1; i < 400; i++) {
            uint256 g = 100_000 + i * 7;
            (uint256 used, bool ok) = spend(recipient, 1 ether, 0.01 ether, "", g);
            assertTrue(ok);
            if (i == 1) overhead = used - g;
            assertEq(used - g, overhead, "unused gas left in the guard");
            assertEq(wallet.balance, 0);
        }
    }

    function test_burnsEveryUnitOfGas_bridgeLikeTarget() public {
        DepositTarget t = new DepositTarget();
        bytes memory data = abi.encodeWithSignature("depositNative(address,bytes32)", wallet, bytes32(uint256(7)));
        // Warm-up: cold accounts and the first storage write are charged once
        spend(address(t), 1 ether, 0, data, 200_000);
        spend(address(t), 1 ether, 0, data, 200_000);
        uint256 overhead;
        for (uint256 i = 1; i < 120; i++) {
            uint256 g = 200_000 + i * 31;
            (uint256 used, bool ok) = spend(address(t), 1 ether, 0, data, g);
            assertTrue(ok);
            if (i == 1) overhead = used - g;
            assertEq(used - g, overhead, "unused gas left in the guard");
        }
        assertEq(t.deposits(), 121);
    }

    /// Absolute check: a contract that is one INVALID opcode consumes every unit of gas it gets
    /// (the call's 2,300 stipend included). Called the same way, the guard must cost exactly as much.
    /// The slope tests above cannot see a constant leftover; this one can (mutation-checked: a tail
    /// one gas off passes the slope tests and fails here).
    function test_burnsExactlyAsMuchAsAnInvalidOpcode() public {
        address invalid = makeAddr("invalid");
        vm.etch(invalid, hex"fe");
        uint256 r = 0;
        for (uint256 i = 0; i < 64; i++) {
            uint256 g = 100_000 + i * 13;
            // Warm both before measuring, then measure each the same way
            spendAt(invalid, recipient, 1 ether, 0, "", g);
            spend(recipient, 1 ether, 0, "", g);
            (uint256 refUsed,) = spendAt(invalid, recipient, 1 ether, 0, "", g);
            (uint256 used, bool ok) = spend(recipient, 1 ether, 0, "", g);
            assertTrue(ok);
            assertEq(used, refUsed, "the guard left gas unused");
            r++;
        }
        assertEq(r, 64);
    }

    function test_paysTheFeeAndForwardsTheRest() public {
        uint256 z0 = ZERODUST.balance;
        (, bool ok) = spend(recipient, 1 ether, 0.01 ether, "", 100_000);
        assertTrue(ok);
        assertEq(ZERODUST.balance - z0, 0.01 ether);
        assertEq(recipient.balance, 0.99 ether);
        assertEq(address(guard).balance, 0);
    }

    function expectRevertWith(bytes4 selector, address target, uint256 deal, uint256 value, uint256 fee, bytes memory data, uint256 g) internal {
        vm.deal(wallet, deal);
        vm.prank(wallet);
        (bool ok, bytes memory ret) = address(guard).call{value: value, gas: g}(abi.encodeCall(IZeroDustGuard.sweep, (target, fee, data)));
        assertFalse(ok);
        assertEq(bytes4(ret), selector);
    }

    function test_refusesAWalletNotAtZero() public {
        // One wei more than the plan: the L1 fee came out lower than planned
        expectRevertWith(0x65a44a69, recipient, 1 ether + 1, 1 ether, 0, "", 100_000);
    }

    function test_refusesAnythingRefundedToTheWallet() public {
        RefundingTarget t = new RefundingTarget{value: 1}(wallet);
        expectRevertWith(0xcfe01bfb, address(t), 1 ether, 1 ether, 0, "", 100_000);
    }

    function test_refusesAFailedCallAFeeAboveTheValueAndTooLittleGas() public {
        RevertingTarget r = new RevertingTarget();
        expectRevertWith(0x3204506f, address(r), 1 ether, 1 ether, 0, "", 100_000);
        expectRevertWith(0x779fecd8, recipient, 1 ether, 1 ether, 1 ether + 1, "", 100_000);
        // Too little gas to finish: the call fails and nothing moves
        vm.deal(wallet, 1 ether);
        vm.prank(wallet);
        (bool ok,) = address(guard).call{value: 1 ether, gas: 20_000}(abi.encodeCall(IZeroDustGuard.sweep, (recipient, 0, "")));
        assertFalse(ok);
        assertEq(recipient.balance, 0);
    }

    function test_refusesBadCalldata() public {
        vm.deal(wallet, 1 ether);
        vm.prank(wallet);
        (bool ok, bytes memory ret) = address(guard).call{value: 1 ether}(hex"deadbeef");
        assertFalse(ok);
        assertEq(bytes4(ret), bytes4(0x1a2e1594));
        // An address with high bits set
        vm.prank(wallet);
        (ok, ret) = address(guard).call{value: 0}(abi.encodePacked(bytes4(0x1a8b33c4), bytes32(type(uint256).max), uint256(0), uint256(96), uint256(0)));
        assertFalse(ok);
        assertEq(bytes4(ret), bytes4(0x1a2e1594));
    }
}
