// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ZeroDustSweep} from "../src/ZeroDustSweepMainnet.sol";

/**
 * @title ZeroDustSweep test suite
 * @notice Covers the invariants that protect user funds and the sponsor.
 *
 * The contract is immutable, has no admin functions and no pause, is deployed to
 * 26 mainnets, and moves a user's entire native balance. There is no lever to
 * pull if something is wrong, so the properties below are the whole safety
 * argument.
 *
 * Every test runs through a real EIP-7702 delegation (`vm.signAndAttachDelegation`)
 * rather than `vm.etch`, because the delegated execution context is exactly where
 * this contract is unusual: `address(this)` is the user's EOA, storage writes land
 * in the user's storage, and the EIP-712 domain binds to the user's address. A
 * test that called the implementation directly would verify none of that.
 */
contract ZeroDustSweepTest is Test {
    ZeroDustSweep internal impl;

    uint256 internal constant USER_PK = 0xA11CE;
    uint256 internal constant OTHER_PK = 0xB0B;
    address internal user;
    address internal other;

    address internal sponsor = address(0x5901);
    address internal sponsor2 = address(0x5902);
    address internal destination = address(0xDE57);

    // Deploy bounds, mirroring production shape.
    uint256 internal constant MIN_OVERHEAD = 50_000;
    uint256 internal constant MAX_OVERHEAD = 300_000;
    uint256 internal constant MAX_PROTOCOL_FEE = 100_000;
    uint256 internal constant MAX_EXTRA_FEE = 0.0005 ether;
    uint256 internal constant MAX_GAS_CAP = 1000 gwei;

    bytes32 internal constant EMPTY_ROUTE_HASH = keccak256("");

    function setUp() public {
        user = vm.addr(USER_PK);
        other = vm.addr(OTHER_PK);

        address[] memory sponsors = new address[](2);
        sponsors[0] = sponsor;
        sponsors[1] = sponsor2;

        impl = new ZeroDustSweep(
            sponsors, MIN_OVERHEAD, MAX_OVERHEAD, MAX_PROTOCOL_FEE, MAX_EXTRA_FEE, MAX_GAS_CAP
        );

        // A realistic gas price so reimbursement arithmetic is non-trivial.
        vm.txGasPrice(1 gwei);
        vm.warp(1_000_000);
    }

    // ============ Helpers ============

    /// Delegates the user's EOA to the implementation, as EIP-7702 does in production.
    function _delegate() internal {
        vm.signAndAttachDelegation(address(impl), USER_PK);
    }

    function _baseIntent(uint256 balance) internal view returns (ZeroDustSweep.SweepIntent memory s) {
        s = ZeroDustSweep.SweepIntent({
            mode: 0,
            user: user,
            destination: destination,
            destinationChainId: block.chainid,
            callTarget: address(0),
            routeHash: EMPTY_ROUTE_HASH,
            minReceive: 0,
            // Sized to stay inside the 150% overestimate guardrail for these tests.
            maxTotalFeeWei: 0,
            overheadGasUnits: MIN_OVERHEAD,
            protocolFeeGasUnits: 0,
            extraFeeWei: 0,
            reimbGasPriceCapWei: 1 gwei,
            deadline: block.timestamp + 30,
            nonce: 0
        });
        // Fee reserve must cover reimbursement; the guardrail rejects padding
        // beyond 150%, so aim near the true cost.
        s.maxTotalFeeWei = _expectedReimb(s);
        balance; // silence unused warning; callers set balance separately
    }

    /// Rough expected reimbursement: (measured + overhead + protocolFee) * gasPrice + extraFee.
    ///
    /// The assumed measured-gas figure matters more than it looks. The contract
    /// requires feeReserve >= reimbWei (FeeExceedsCap) AND feeReserve <= 150% of
    /// reimbWei (OverestimateTooHigh), so the reserve has to bracket the real
    /// cost fairly tightly. MODE_CALL gas depends on what the target itself
    /// burns, so a reserve sized for a heavy bridge trips the guardrail when
    /// routing to a cheap one - see test_callMode_cheapTargetTripsOverestimateGuardrail.
    function _expectedReimb(ZeroDustSweep.SweepIntent memory s) internal pure returns (uint256) {
        return _reimbAssuming(s, 60_000);
    }

    function _reimbAssuming(ZeroDustSweep.SweepIntent memory s, uint256 assumedMeasured)
        internal
        pure
        returns (uint256)
    {
        return (assumedMeasured + s.overheadGasUnits + s.protocolFeeGasUnits) * 1 gwei + s.extraFeeWei;
    }

    function _domainSeparator(address account) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("ZeroDust")),
                keccak256(bytes("3")),
                block.chainid,
                account
            )
        );
    }

    function _structHash(ZeroDustSweep.SweepIntent memory s) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                impl.SWEEP_TYPEHASH(),
                s.mode,
                s.user,
                s.destination,
                s.destinationChainId,
                s.callTarget,
                s.routeHash,
                s.minReceive,
                s.maxTotalFeeWei,
                s.overheadGasUnits,
                s.protocolFeeGasUnits,
                s.extraFeeWei,
                s.reimbGasPriceCapWei,
                s.deadline,
                s.nonce
            )
        );
    }

    function _sign(ZeroDustSweep.SweepIntent memory s, uint256 pk) internal view returns (bytes memory) {
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", _domainSeparator(s.user), _structHash(s)));
        (uint8 v, bytes32 r, bytes32 sig_s) = vm.sign(pk, digest);
        return abi.encodePacked(r, sig_s, v);
    }

    function _sweep(ZeroDustSweep.SweepIntent memory s, bytes memory sig, bytes memory callData) internal {
        vm.prank(sponsor);
        ZeroDustSweep(payable(user)).sweep(s, sig, callData);
    }

    // ============ The core promise: exactly zero ============

    function test_transfer_leavesExactlyZero() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        _sweep(s, _sign(s, USER_PK), "");

        // The entire product proposition.
        assertEq(user.balance, 0, "source must be exactly zero");
        assertGt(destination.balance, 0, "destination must receive funds");
    }

    function testFuzz_transfer_leavesExactlyZero(uint96 balance) public {
        // Below the fee reserve there is nothing to route and the call reverts,
        // which is covered separately.
        balance = uint96(bound(balance, 0.01 ether, 100 ether));

        _delegate();
        vm.deal(user, balance);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(balance);
        _sweep(s, _sign(s, USER_PK), "");

        assertEq(user.balance, 0, "source must be exactly zero for any balance");
    }

    function test_conservationOfValue() public {
        _delegate();
        vm.deal(user, 1 ether);
        uint256 sponsorBefore = sponsor.balance;

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        _sweep(s, _sign(s, USER_PK), "");

        // Nothing may be created or destroyed: every wei goes to the destination
        // or the sponsor.
        assertEq(
            destination.balance + (sponsor.balance - sponsorBefore),
            1 ether,
            "value must be conserved across destination and sponsor"
        );
    }

    // ============ The user's money protection: maxTotalFeeWei ============

    function test_sponsorNeverTakesMoreThanMaxTotalFee() public {
        _delegate();
        vm.deal(user, 1 ether);
        uint256 sponsorBefore = sponsor.balance;

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        _sweep(s, _sign(s, USER_PK), "");

        assertLe(
            sponsor.balance - sponsorBefore,
            s.maxTotalFeeWei,
            "sponsor took more than the signed cap"
        );
    }

    function testFuzz_sponsorNeverTakesMoreThanMaxTotalFee(uint96 balance, uint64 gasPrice) public {
        balance = uint96(bound(balance, 0.01 ether, 100 ether));
        // Gas price may exceed the per-intent cap; the contract must clamp.
        gasPrice = uint64(bound(gasPrice, 1, 500 gwei));
        vm.txGasPrice(gasPrice);

        _delegate();
        vm.deal(user, balance);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(balance);
        uint256 sponsorBefore = sponsor.balance;

        // A gas spike can push reimbursement past the reserve, which reverts
        // rather than overcharging. Either outcome is acceptable; taking more
        // than the cap is not.
        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        try ZeroDustSweep(payable(user)).sweep(s, sig, "") {
            assertLe(
                sponsor.balance - sponsorBefore,
                s.maxTotalFeeWei,
                "sponsor exceeded the signed fee cap"
            );
            assertEq(user.balance, 0, "source must be exactly zero");
        } catch {
            assertEq(user.balance, balance, "failed sweep must not move funds");
        }
    }

    function test_gasPriceAboveCapIsClamped() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.reimbGasPriceCapWei = 1 gwei;
        s.maxTotalFeeWei = _expectedReimb(s);

        // Real gas price 100x the signed cap. Reimbursement must use the cap, so
        // the sponsor eats the difference rather than the user.
        vm.txGasPrice(100 gwei);

        uint256 sponsorBefore = sponsor.balance;
        _sweep(s, _sign(s, USER_PK), "");

        assertLe(sponsor.balance - sponsorBefore, s.maxTotalFeeWei, "cap not applied");
    }

    function test_minReceiveEnforcedOnTransfer() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.minReceive = 1 ether; // impossible once the fee reserve is withheld
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.BelowMinReceive.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    // ============ Signature and replay ============

    function test_rejectsWrongSigner() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);

        bytes memory sig = _sign(s, OTHER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.InvalidSignature.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_rejectsTamperedDestination() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        bytes memory sig = _sign(s, USER_PK);

        // Redirect funds after signing - the signature must no longer verify.
        s.destination = other;

        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.InvalidSignature.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_rejectsTamperedFeeCap() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        bytes memory sig = _sign(s, USER_PK);

        // A sponsor raising its own fee ceiling after the user signed.
        s.maxTotalFeeWei = 0.5 ether;

        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.InvalidSignature.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_nonceReplayRejected() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        bytes memory sig = _sign(s, USER_PK);
        _sweep(s, sig, "");

        // Refund the account and replay the identical intent.
        vm.deal(user, 1 ether);

        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.NonceMismatch.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_nonceAdvancesInUserStorage() public {
        _delegate();
        vm.deal(user, 1 ether);

        assertEq(ZeroDustSweep(payable(user)).nonce(), 0, "nonce starts at zero");

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        _sweep(s, _sign(s, USER_PK), "");

        // Under 7702 the write lands in the USER's storage, not the implementation's.
        assertEq(ZeroDustSweep(payable(user)).nonce(), 1, "user nonce must advance");
        assertEq(impl.nonce(), 0, "implementation storage must be untouched");
    }

    function test_signatureIsBoundToTheUserAccount() public {
        // The EIP-712 domain uses address(this), which under 7702 is the user's
        // EOA. A signature made for one account must not work on another.
        _delegate();
        vm.signAndAttachDelegation(address(impl), OTHER_PK);

        vm.deal(user, 1 ether);
        vm.deal(other, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        bytes memory sig = _sign(s, USER_PK); // signed against user's domain

        // Present the same intent to the other delegated account.
        s.user = other;

        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.InvalidSignature.selector);
        ZeroDustSweep(payable(other)).sweep(s, sig, "");
    }

    function test_rejectsMalformedSignatureLength() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);

        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.InvalidSignature.selector);
        ZeroDustSweep(payable(user)).sweep(s, hex"deadbeef", "");
    }

    function test_rejectsHighSSignature() public {
        // EIP-2 low-s: the malleable counterpart of a valid signature must be
        // rejected, or one intent has two valid encodings.
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", _domainSeparator(s.user), _structHash(s)));
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(USER_PK, digest);

        // Flip to the high-s form.
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 highS = bytes32(n - uint256(sigS));
        uint8 flippedV = v == 27 ? 28 : 27;

        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.InvalidSignature.selector);
        ZeroDustSweep(payable(user)).sweep(s, abi.encodePacked(r, highS, flippedV), "");
    }

    // ============ Access control ============

    function test_onlySponsorMayCall() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        bytes memory sig = _sign(s, USER_PK);

        vm.prank(other);
        vm.expectRevert(ZeroDustSweep.NotSponsor.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_userCannotCallTheirOwnSweep() public {
        // Even the owner of the funds is not a sponsor. Worth pinning: it is
        // surprising, and it is what makes the gas sponsorship model work.
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        bytes memory sig = _sign(s, USER_PK);

        vm.prank(user);
        vm.expectRevert(ZeroDustSweep.NotSponsor.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_secondSponsorAccepted() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor2);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");

        assertEq(user.balance, 0, "second sponsor must be able to settle");
    }

    // ============ Deadlines ============

    function test_expiredDeadlineRejected() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.deadline = block.timestamp - 1;
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.DeadlineExpired.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_deadlineTooFarRejected() public {
        // The 60s window is what stops a sponsor sitting on a signed intent and
        // settling it during a gas spike.
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.deadline = block.timestamp + 61;
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.DeadlineTooFar.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_deadlineAtExactBoundaryAccepted() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.deadline = block.timestamp + 60;
        s.maxTotalFeeWei = _expectedReimb(s);

        _sweep(s, _sign(s, USER_PK), "");
        assertEq(user.balance, 0, "exact boundary must be accepted");
    }

    // ============ Parameter bounds ============

    function test_overheadBelowMinimumRejected() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.overheadGasUnits = MIN_OVERHEAD - 1;
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.OverheadTooLow.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_overheadAboveMaximumRejected() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.overheadGasUnits = MAX_OVERHEAD + 1;
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.OverheadTooHigh.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_extraFeeAboveMaximumRejected() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.extraFeeWei = MAX_EXTRA_FEE + 1;
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.ExtraFeeTooHigh.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_zeroGasPriceCapRejected() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.reimbGasPriceCapWei = 0;
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.GasPriceCapZero.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_overestimatedFeeReserveRejected() public {
        // The 150% guardrail: a sponsor cannot pad the cap and pocket the slack.
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.maxTotalFeeWei = _expectedReimb(s) * 10;

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.OverestimateTooHigh.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    // ============ Mode validation ============

    function test_transferModeRejectsCallData() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.InvalidMode.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, hex"1234");
    }

    function test_transferModeRejectsZeroDestination() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.destination = address(0);
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.InvalidMode.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_unknownModeRejected() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.mode = 2;
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.InvalidMode.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_insufficientBalanceRejected() public {
        _delegate();

        ZeroDustSweep.SweepIntent memory s = _baseIntent(0);
        // Balance entirely consumed by the fee reserve leaves nothing to route.
        vm.deal(user, s.maxTotalFeeWei);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.InsufficientBalance.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    // ============ MODE_CALL / routeHash ============

    function test_callMode_routesFundsAndZeroesSource() public {
        _delegate();
        vm.deal(user, 1 ether);

        BridgeMock bridge = new BridgeMock();
        bytes memory callData = abi.encodeCall(BridgeMock.deposit, (destination));

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.mode = 1;
        s.callTarget = address(bridge);
        s.routeHash = keccak256(callData);
        s.maxTotalFeeWei = _expectedReimb(s);

        _sweep(s, _sign(s, USER_PK), callData);

        assertEq(user.balance, 0, "source must be exactly zero");
        assertGt(address(bridge).balance, 0, "bridge must receive the routed value");
    }

    function test_callMode_rejectsMismatchedRouteHash() public {
        // routeHash binding is what stops a sponsor swapping the bridge calldata
        // for one that sends funds elsewhere.
        _delegate();
        vm.deal(user, 1 ether);

        BridgeMock bridge = new BridgeMock();
        bytes memory signedData = abi.encodeCall(BridgeMock.deposit, (destination));
        bytes memory swappedData = abi.encodeCall(BridgeMock.deposit, (other));

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.mode = 1;
        s.callTarget = address(bridge);
        s.routeHash = keccak256(signedData);
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.RouteHashMismatch.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, swappedData);
    }

    function test_callMode_rejectsNonContractTarget() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.mode = 1;
        s.callTarget = other; // an EOA
        s.routeHash = keccak256(hex"1234");
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.TargetNotContract.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, hex"1234");
    }

    function test_callMode_revertingBridgeLeavesFundsUntouched() public {
        // If routing fails the whole transaction must revert, leaving the user's
        // balance exactly as it was. A partial failure would strand funds.
        _delegate();
        vm.deal(user, 1 ether);

        RevertingBridge bridge = new RevertingBridge();
        bytes memory callData = abi.encodeCall(RevertingBridge.fail, ());

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.mode = 1;
        s.callTarget = address(bridge);
        s.routeHash = keccak256(callData);
        s.maxTotalFeeWei = _expectedReimb(s);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert();
        ZeroDustSweep(payable(user)).sweep(s, sig, callData);

        assertEq(user.balance, 1 ether, "failed routing must not move funds");
        assertEq(ZeroDustSweep(payable(user)).nonce(), 0, "failed sweep must not consume the nonce");
    }

    function test_callMode_refundingBridgeIsRejected() public {
        // A target that sends value back leaves a non-zero remainder, which
        // breaks the core promise and must revert.
        _delegate();
        vm.deal(user, 1 ether);

        RefundingBridge bridge = new RefundingBridge();
        bytes memory callData = abi.encodeCall(RefundingBridge.depositAndRefund, ());

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.mode = 1;
        s.callTarget = address(bridge);
        s.routeHash = keccak256(callData);
        // Sized to this target's actual gas. Reserving for a heavier target
        // trips the overestimate guardrail before the remainder check runs.
        s.maxTotalFeeWei = _reimbAssuming(s, 20_000);

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.NonZeroRemainder.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, callData);
    }

    function test_callMode_cheapTargetTripsOverestimateGuardrail() public {
        // Documents a real operational constraint rather than a bug: the fee
        // reserve must be sized to the gas the routing target actually burns.
        // A quote padded for a storage-writing bridge reverts when the call
        // turns out to be cheap. The backend's quote engine has to account for
        // this - it is the difference between a sweep settling and reverting.
        _delegate();
        vm.deal(user, 1 ether);

        RefundingBridge bridge = new RefundingBridge();
        bytes memory callData = abi.encodeCall(RefundingBridge.depositAndRefund, ());

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.mode = 1;
        s.callTarget = address(bridge);
        s.routeHash = keccak256(callData);
        s.maxTotalFeeWei = _reimbAssuming(s, 60_000); // padded for a heavier target

        bytes memory sig = _sign(s, USER_PK);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.OverestimateTooHigh.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, callData);
    }

    // ============ Reentrancy ============

    function test_reentrancyGuardBlocksASponsorReentering() public {
        // The reentrancy guard sits BEHIND the sponsor gate (_onlySponsor runs
        // first), so only a malicious or compromised sponsor can ever reach it.
        // That ordering is itself the primary mitigation - but the guard is the
        // backstop, and this is the only way to exercise it.
        //
        // Sponsors must be EOAs at deploy time, so the address is registered as
        // a sponsor first and given code afterwards, which is exactly what a
        // sponsor key turning malicious would look like.
        address payable evilSponsor = payable(address(0xBEEF));

        address[] memory sponsors = new address[](1);
        sponsors[0] = evilSponsor;
        ZeroDustSweep reentrantImpl = new ZeroDustSweep(
            sponsors, MIN_OVERHEAD, MAX_OVERHEAD, MAX_PROTOCOL_FEE, MAX_EXTRA_FEE, MAX_GAS_CAP
        );

        vm.etch(evilSponsor, type(ReentrantSponsor).runtimeCode);
        vm.signAndAttachDelegation(address(reentrantImpl), USER_PK);
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.destination = evilSponsor; // paid mid-sweep, re-enters from receive()
        s.maxTotalFeeWei = _expectedReimb(s);
        bytes memory sig = _sign(s, USER_PK);

        ReentrantSponsor(evilSponsor).arm(payable(user), s, sig);

        vm.prank(evilSponsor);
        try ZeroDustSweep(payable(user)).sweep(s, sig, "") {
            assertEq(user.balance, 0, "source must be exactly zero");
            assertEq(ZeroDustSweep(payable(user)).nonce(), 1, "nonce must advance exactly once");
        } catch {
            assertEq(user.balance, 1 ether, "reverted sweep must not move funds");
        }

        // The specific selector matters. Without it this test passes even with
        // the guard removed, because the reentrant call fails for other reasons.
        assertEq(
            ReentrantSponsor(evilSponsor).lastRevertSelector(),
            ZeroDustSweep.Reentrancy.selector,
            "reentrant call must be rejected by the reentrancy guard specifically"
        );
    }

    // ============ Fee reserve must cover reimbursement ============

    function test_reimbursementAboveReserveRejected() public {
        // If the signed cap cannot cover the sponsor's real cost the sweep must
        // revert rather than dip into the user's routed funds.
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.maxTotalFeeWei = 1000 wei; // far below any real gas cost
        bytes memory sig = _sign(s, USER_PK);

        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.FeeExceedsCap.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");
    }

    function test_reimbursementAboveReserveLeavesFundsUntouched() public {
        _delegate();
        vm.deal(user, 1 ether);

        ZeroDustSweep.SweepIntent memory s = _baseIntent(1 ether);
        s.maxTotalFeeWei = 1000 wei;
        bytes memory sig = _sign(s, USER_PK);

        vm.prank(sponsor);
        vm.expectRevert(ZeroDustSweep.FeeExceedsCap.selector);
        ZeroDustSweep(payable(user)).sweep(s, sig, "");

        assertEq(user.balance, 1 ether, "user funds must be intact after a rejected sweep");
        assertEq(destination.balance, 0, "destination must not have been paid");
    }

    // ============ Delegated-account behaviour ============

    function test_delegatedAccountCanStillReceiveETH() public {
        // receive() exists so a delegated wallet is not bricked for plain
        // transfers. Without it, funds sent mid-delegation would revert.
        _delegate();

        vm.deal(other, 1 ether);
        vm.prank(other);
        (bool ok,) = user.call{value: 0.5 ether}("");

        assertTrue(ok, "delegated account must accept plain transfers");
        assertEq(user.balance, 0.5 ether);
    }

    function test_isSponsorView() public view {
        assertTrue(impl.isSponsor(sponsor));
        assertTrue(impl.isSponsor(sponsor2));
        assertFalse(impl.isSponsor(other));
    }

    // ============ Constructor validation ============

    function test_constructorRejectsNoSponsors() public {
        address[] memory none = new address[](0);
        vm.expectRevert(ZeroDustSweep.NoSponsors.selector);
        new ZeroDustSweep(none, MIN_OVERHEAD, MAX_OVERHEAD, MAX_PROTOCOL_FEE, MAX_EXTRA_FEE, MAX_GAS_CAP);
    }

    function test_constructorRejectsTooManySponsors() public {
        address[] memory many = new address[](4);
        for (uint256 i = 0; i < 4; i++) many[i] = address(uint160(i + 1));
        vm.expectRevert(ZeroDustSweep.TooManySponsors.selector);
        new ZeroDustSweep(many, MIN_OVERHEAD, MAX_OVERHEAD, MAX_PROTOCOL_FEE, MAX_EXTRA_FEE, MAX_GAS_CAP);
    }

    function test_constructorRejectsContractSponsor() public {
        address[] memory one = new address[](1);
        one[0] = address(this); // has code
        vm.expectRevert(ZeroDustSweep.SponsorMustBeEOA.selector);
        new ZeroDustSweep(one, MIN_OVERHEAD, MAX_OVERHEAD, MAX_PROTOCOL_FEE, MAX_EXTRA_FEE, MAX_GAS_CAP);
    }
}

// ============ Mocks ============

contract BridgeMock {
    address public lastRecipient;

    function deposit(address recipient) external payable {
        lastRecipient = recipient;
    }

    receive() external payable {}
}

contract RevertingBridge {
    error BridgeUnavailable();

    function fail() external payable {
        revert BridgeUnavailable();
    }
}

/// Sends the value straight back, leaving a non-zero remainder.
contract RefundingBridge {
    function depositAndRefund() external payable {
        (bool ok,) = msg.sender.call{value: msg.value}("");
        require(ok, "refund failed");
    }
}

/// A sponsor that re-enters sweep() when paid, and records why it was rejected.
///
/// Recording the selector rather than a bare boolean is deliberate: a reentrant
/// call fails for several possible reasons, and only one of them means the
/// reentrancy guard did its job.
contract ReentrantSponsor {
    address payable internal target;
    ZeroDustSweep.SweepIntent internal intent;
    bytes internal sig;
    bytes4 public lastRevertSelector;
    bool internal armed;

    function arm(address payable t, ZeroDustSweep.SweepIntent memory s, bytes memory signature) external {
        target = t;
        intent = s;
        sig = signature;
        armed = true;
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        try ZeroDustSweep(target).sweep(intent, sig, "") {
            lastRevertSelector = bytes4(0); // reentrancy succeeded - guard failed
        } catch (bytes memory err) {
            if (err.length >= 4) {
                lastRevertSelector = bytes4(err);
            }
        }
    }
}
