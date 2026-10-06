// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ZeroDustPermissionRouter } from "../src/ZeroDustPermissionRouter.sol";

/**
 * Offline tests (no RPC): MetaMask's DelegationManager is replaced at its fixed address by a mock
 * that can misbehave on purpose, and the user is an EOA with a real EIP-7702 delegation to a mock
 * smart account. Covers the checks a real fork cannot reach (a redemption that leaves a balance or
 * splits the funds) and every parameter bound. The real-contract path is in the .fork.t.sol file.
 */
contract ZeroDustPermissionRouterTest is Test {
    address constant DM = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    uint256 constant USER_PK = 0xA11CE;
    address user;
    address sponsor = makeAddr("sponsor");
    address destination = makeAddr("destination");
    address elsewhere = makeAddr("elsewhere");
    ZeroDustPermissionRouter router;
    MockDelegationManager dm;

    function setUp() public {
        user = vm.addr(USER_PK);
        address[] memory sponsors = new address[](1);
        sponsors[0] = sponsor;
        router = new ZeroDustPermissionRouter(sponsors, 50_000, 300_000, 100_000, 1 ether, 1000 gwei);
        vm.etch(DM, address(new MockDelegationManager()).code);
        dm = MockDelegationManager(DM);
        MockSmartAccount account = new MockSmartAccount();
        vm.signAndAttachDelegation(address(account), USER_PK);
        vm.deal(user, 1 ether);
        vm.txGasPrice(1);
    }

    function _permission(address delegator, address delegate) internal pure returns (bytes memory) {
        ZeroDustPermissionRouter.Delegation[] memory ds = new ZeroDustPermissionRouter.Delegation[](1);
        ds[0] = ZeroDustPermissionRouter.Delegation(
            delegate, delegator, bytes32(type(uint256).max), new ZeroDustPermissionRouter.Caveat[](0), 0, ""
        );
        return abi.encode(ds);
    }

    function _intent() internal view returns (ZeroDustPermissionRouter.SweepIntent memory) {
        return ZeroDustPermissionRouter.SweepIntent({
            mode: 0,
            user: user,
            destination: destination,
            destinationChainId: block.chainid,
            callTarget: address(0),
            routeHash: keccak256(""),
            minReceive: 0,
            maxTotalFeeWei: 0.01 ether + 2_000_000,
            overheadGasUnits: 60_000,
            protocolFeeGasUnits: 0,
            extraFeeWei: 0.01 ether,
            reimbGasPriceCapWei: 1,
            deadline: block.timestamp + 30,
            nonce: 0
        });
    }

    function _sweep(ZeroDustPermissionRouter.SweepIntent memory s, bytes memory callData) internal {
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(USER_PK, router.hashIntent(s));
        bytes memory sig = abi.encodePacked(r, sg, v);
        bytes memory permission = _permission(s.user, address(router));
        vm.prank(sponsor);
        router.sweep(s, sig, callData, permission);
    }

    function _expectSweepRevert(ZeroDustPermissionRouter.SweepIntent memory s, bytes memory callData, bytes4 err)
        internal
    {
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(USER_PK, router.hashIntent(s));
        bytes memory sig = abi.encodePacked(r, sg, v);
        bytes memory permission = _permission(s.user, address(router));
        vm.prank(sponsor);
        vm.expectRevert(err);
        router.sweep(s, sig, callData, permission);
    }

    // ===== Exact zero and the router's own balance =====

    function test_exactRedemptionSettles() public {
        _sweep(_intent(), "");
        assertEq(user.balance, 0);
        assertEq(destination.balance, 1 ether - (0.01 ether + 2_000_000));
        assertEq(sponsor.balance, 0.01 ether + 2_000_000);
        assertEq(address(router).balance, 0);
    }

    function test_redemptionLeavingABalanceReverts() public {
        dm.setShortBy(1); // the account sends amount - 1
        _expectSweepRevert(_intent(), "", ZeroDustPermissionRouter.NonZeroRemainder.selector);
        assertEq(user.balance, 1 ether);
    }

    function test_redemptionSplittingTheFundsReverts() public {
        dm.setSplitTo(elsewhere, 1); // the account sends 1 wei elsewhere and the rest here
        _expectSweepRevert(_intent(), "", ZeroDustPermissionRouter.AmountMismatch.selector);
        assertEq(user.balance, 1 ether);
    }

    function test_emptyWalletReverts() public {
        vm.deal(user, 0);
        _expectSweepRevert(_intent(), "", ZeroDustPermissionRouter.InsufficientBalance.selector);
    }

    function test_feeReserveTakingEverythingReverts() public {
        vm.deal(user, 0.01 ether);
        _expectSweepRevert(_intent(), "", ZeroDustPermissionRouter.InsufficientBalance.selector);
    }

    // ===== Settlement rules =====

    function test_minReceiveEnforcedForTransfers() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.minReceive = 1 ether;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.BelowMinReceive.selector);
    }

    function test_reserveBelowTheReimbursementReverts() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.maxTotalFeeWei = 0.01 ether; // the gas term pushes reimbursement above it
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.FeeExceedsCap.selector);
    }

    function test_reserveAboveTheGuardrailReverts() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.maxTotalFeeWei = 0.016 ether;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.OverestimateTooHigh.selector);
    }

    function test_zeroReimbursementIsAnOverestimate() public {
        vm.txGasPrice(0);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.extraFeeWei = 0;
        s.maxTotalFeeWei = 1;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.OverestimateTooHigh.selector);
    }

    function test_failingBridgeCallReverts() public {
        RevertingBridge bridge = new RevertingBridge();
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.mode = 1;
        s.callTarget = address(bridge);
        s.routeHash = keccak256("x");
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(USER_PK, router.hashIntent(s));
        bytes memory sig = abi.encodePacked(r, sg, v);
        bytes memory permission = _permission(user, address(router));
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(ZeroDustPermissionRouter.CallFailed.selector, bytes("")));
        router.sweep(s, sig, "x", permission);
    }

    // ===== Intent bounds =====

    function test_overheadBounds() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.overheadGasUnits = 49_999;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.OverheadTooLow.selector);
        s.overheadGasUnits = 300_001;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.OverheadTooHigh.selector);
    }

    function test_feeParameterBounds() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.protocolFeeGasUnits = 100_001;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.ProtocolFeeTooHigh.selector);
        s = _intent();
        s.extraFeeWei = 1 ether + 1;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.ExtraFeeTooHigh.selector);
        s = _intent();
        s.reimbGasPriceCapWei = 0;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.GasPriceCapZero.selector);
        s.reimbGasPriceCapWei = 1000 gwei + 1;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.GasPriceCapTooHigh.selector);
    }

    function test_modeRules() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        _expectSweepRevert(s, "x", ZeroDustPermissionRouter.InvalidMode.selector);
        s.routeHash = keccak256("x");
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.RouteHashMismatch.selector);
        s = _intent();
        s.destination = address(0);
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.InvalidMode.selector);
        s = _intent();
        s.mode = 2;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.InvalidMode.selector);
        s = _intent();
        s.mode = 1;
        s.callTarget = elsewhere; // no code
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.TargetNotContract.selector);
        s.callTarget = address(new RevertingBridge());
        s.destination = address(0);
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.InvalidDestination.selector);
        s.destination = destination;
        s.destinationChainId = 0;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.InvalidDestination.selector);
    }

    function test_malformedSignatures() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        bytes memory permission = _permission(user, address(router));
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(USER_PK, router.hashIntent(s));
        bytes[3] memory bad = [
            abi.encodePacked(r, sg), // wrong length
            abi.encodePacked(r, sg, uint8(29)), // bad v
            abi.encodePacked(r, bytes32(type(uint256).max), v) // high s
        ];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(sponsor);
            vm.expectRevert(ZeroDustPermissionRouter.InvalidSignature.selector);
            router.sweep(s, bad[i], "", permission);
        }
    }

    function test_permissionWithSeveralDelegationsIsRefused() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(USER_PK, router.hashIntent(s));
        bytes memory sig = abi.encodePacked(r, sg, v);
        ZeroDustPermissionRouter.Delegation[] memory ds = new ZeroDustPermissionRouter.Delegation[](2);
        ds[0] = ZeroDustPermissionRouter.Delegation(
            address(router), user, bytes32(0), new ZeroDustPermissionRouter.Caveat[](0), 0, ""
        );
        ds[1] = ds[0];
        bytes memory permission = abi.encode(ds);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.InvalidPermission.selector);
        router.sweep(s, sig, "", permission);
    }

    function test_reentryFromTheDestinationIsBlocked() public {
        Reenterer r = new Reenterer(router);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.destination = address(r);
        _sweep(s, "");
        assertEq(r.reverted(), true);
        assertEq(user.balance, 0);
    }

    // ===== Checks the happy paths cannot reach (each one was found by removing it) =====

    function test_reentryThroughADelegatedSponsorIsBlocked() public {
        // A sponsor is an EOA, but an EOA can carry EIP-7702 code: the fee payout must not reopen sweep()
        vm.etch(sponsor, address(new SponsorReenterer()).code);
        SponsorReenterer(payable(sponsor)).setRouter(router);
        _sweep(_intent(), "");
        assertEq(SponsorReenterer(payable(sponsor)).lastError(), ZeroDustPermissionRouter.Reentrancy.selector);
    }

    function test_zeroFeeIntentIsRefused() public {
        vm.txGasPrice(0);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.extraFeeWei = 0;
        s.maxTotalFeeWei = 0;
        _expectSweepRevert(s, "", ZeroDustPermissionRouter.OverestimateTooHigh.selector);
    }

    function test_etherForcedIntoTheRouterMidSweepReverts() public {
        // SELFDESTRUCT still moves ETH past receive(); the router must not end a sweep holding it
        ForcingBridge bridge = new ForcingBridge{ value: 1 }(address(router));
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.mode = 1;
        s.callTarget = address(bridge);
        s.routeHash = keccak256("x");
        _expectSweepRevert(s, "x", ZeroDustPermissionRouter.RouterBalanceChanged.selector);
    }

    function test_signatureWithTrailingBytesIsRefused() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(USER_PK, router.hashIntent(s));
        bytes memory permission = _permission(user, address(router));
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.InvalidSignature.selector);
        router.sweep(s, abi.encodePacked(r, sg, v, uint8(0)), "", permission);
    }

    function test_malleableSignatureIsRefused() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(USER_PK, router.hashIntent(s));
        uint256 n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(n - uint256(sg)), v == 27 ? uint8(28) : uint8(27));
        bytes memory permission = _permission(user, address(router));
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.InvalidSignature.selector);
        router.sweep(s, flipped, "", permission);
    }

    function test_unrecoverableSignatureForTheZeroAddressIsRefused() public {
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        s.user = address(0);
        bytes memory permission = _permission(address(0), address(router));
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.InvalidSignature.selector);
        router.sweep(s, abi.encodePacked(bytes32(0), bytes32(uint256(1)), uint8(27)), "", permission);
    }

    function test_zeroAddressIsNotASponsor() public {
        // With one sponsor configured, SPONSOR_2 and SPONSOR_3 are address(0)
        ZeroDustPermissionRouter.SweepIntent memory s = _intent();
        vm.prank(address(0));
        vm.expectRevert(ZeroDustPermissionRouter.NotSponsor.selector);
        router.sweep(s, "", "", "");
    }

    // ===== Constructor =====

    function test_constructorBounds() public {
        address[] memory none = new address[](0);
        vm.expectRevert(ZeroDustPermissionRouter.NoSponsors.selector);
        new ZeroDustPermissionRouter(none, 50_000, 300_000, 100_000, 1 ether, 1000 gwei);
        address[] memory four = new address[](4);
        for (uint256 i; i < 4; i++) four[i] = address(uint160(i + 1));
        vm.expectRevert(ZeroDustPermissionRouter.TooManySponsors.selector);
        new ZeroDustPermissionRouter(four, 50_000, 300_000, 100_000, 1 ether, 1000 gwei);
        address[] memory contractSponsor = new address[](1);
        contractSponsor[0] = address(this);
        vm.expectRevert(ZeroDustPermissionRouter.SponsorMustBeEOA.selector);
        new ZeroDustPermissionRouter(contractSponsor, 50_000, 300_000, 100_000, 1 ether, 1000 gwei);
    }
}

/// @dev Stands in for MetaMask's DelegationManager: tells the delegator's account to run the execution
contract MockDelegationManager {
    uint256 public shortBy;
    address public splitTo;
    uint256 public splitAmount;

    function setShortBy(uint256 v) external {
        shortBy = v;
    }

    function setSplitTo(address to, uint256 amount) external {
        splitTo = to;
        splitAmount = amount;
    }

    function redeemDelegations(bytes[] calldata contexts, bytes32[] calldata, bytes[] calldata executions) external {
        ZeroDustPermissionRouter.Delegation[] memory ds =
            abi.decode(contexts[0], (ZeroDustPermissionRouter.Delegation[]));
        bytes calldata e = executions[0];
        address target = address(bytes20(e[0:20]));
        uint256 value = uint256(bytes32(e[20:52]));
        MockSmartAccount(payable(ds[0].delegator)).execute(target, value - shortBy - splitAmount, splitTo, splitAmount);
    }
}

/// @dev Stands in for MetaMask's smart account (EIP7702StatelessDeleGator)
contract MockSmartAccount {
    function execute(address target, uint256 value, address splitTo, uint256 splitAmount) external {
        if (splitAmount > 0) {
            (bool okSplit,) = splitTo.call{ value: splitAmount }("");
            require(okSplit, "split");
        }
        (bool ok,) = target.call{ value: value }("");
        require(ok, "send");
    }

    receive() external payable {}
}

contract RevertingBridge {
    fallback() external payable {
        revert();
    }
}

contract Reenterer {
    ZeroDustPermissionRouter immutable router;
    bool public reverted;

    constructor(ZeroDustPermissionRouter r) {
        router = r;
    }

    receive() external payable {
        ZeroDustPermissionRouter.SweepIntent memory s;
        try router.sweep(s, "", "", "") {
            reverted = false;
        } catch {
            reverted = true;
        }
    }
}

contract SponsorReenterer {
    ZeroDustPermissionRouter router;
    bytes4 public lastError;

    function setRouter(ZeroDustPermissionRouter r) external {
        router = r;
    }

    receive() external payable {
        ZeroDustPermissionRouter.SweepIntent memory s;
        try router.sweep(s, "", "", "") { }
        catch (bytes memory err) {
            lastError = bytes4(err);
        }
    }
}

contract ForcingBridge {
    address immutable target;

    constructor(address t) payable {
        target = t;
    }

    fallback() external payable {
        selfdestruct(payable(target));
    }
}
