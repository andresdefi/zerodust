// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { ZeroDustPermissionRouter } from "../src/ZeroDustPermissionRouter.sol";

/**
 * Fork tests against MetaMask's real Delegation Framework on Base (v1.3.0, same addresses on
 * every chain). The user is an EOA upgraded with a real EIP-7702 delegation to MetaMask's
 * EIP7702StatelessDeleGator, and the permission carries the exact caveats MetaMask created for a
 * one-time native-token allowance in the 2026-10-06 spike (amount, empty calldata, expiry,
 * redeemer, payee, nonce), here naming the router as delegate, redeemer and payee.
 *
 * Needs BASE_RPC_URL (an archive-capable Base RPC); skipped without it.
 */
contract ZeroDustPermissionRouterForkTest is Test {
    // MetaMask Delegation Framework v1.3.0 (Base)
    address constant DM = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    address constant DELEGATOR_IMPL = 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B;
    address constant PERIOD_ENFORCER = 0x9BC0FAf4Aca5AE429F4c06aEEaC517520CB16BD9;
    address constant EXACT_CALLDATA = 0x99F2e9bF15ce5eC84685604836F71aB835DBBdED;
    address constant TIMESTAMP = 0x1046bb45C8d673d4ea75321280DB34899413c069;
    address constant REDEEMER = 0xE144b0b2618071B4E56f746313528a669c7E65c5;
    address constant ALLOWED_TARGETS = 0x7F20f61b1f09b08D970938F6fa563634d65c4EeB;
    address constant NONCE = 0xDE4f2FAC4B3D87A1d9953Ca5FC09FCa7F366254f;
    bytes32 constant ROOT_AUTHORITY = bytes32(type(uint256).max);

    uint256 constant USER_PK = 0xA11CE;
    uint256 constant OTHER_PK = 0xB0B;
    address user;
    address other;
    address sponsor = makeAddr("sponsor");
    address destination = makeAddr("destination");
    ZeroDustPermissionRouter router;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        user = vm.addr(USER_PK);
        other = vm.addr(OTHER_PK);
        address[] memory sponsors = new address[](1);
        sponsors[0] = sponsor;
        router = new ZeroDustPermissionRouter(sponsors, 50_000, 300_000, 100_000, 1 ether, 1000 gwei);
        _upgrade(USER_PK, 1 ether);
        _upgrade(OTHER_PK, 1 ether);
        vm.txGasPrice(1);
    }

    modifier onlyFork() {
        if (!forked) {
            vm.skip(true);
            return;
        }
        _;
    }

    // ===== Helpers =====

    function _upgrade(uint256 pk, uint256 balance) internal {
        vm.signAndAttachDelegation(DELEGATOR_IMPL, pk);
        vm.deal(vm.addr(pk), balance);
    }

    function _caveats(uint256 allowance, address payee, address redeemer)
        internal
        view
        returns (ZeroDustPermissionRouter.Caveat[] memory c)
    {
        c = new ZeroDustPermissionRouter.Caveat[](6);
        // One-time allowance: period amount, period duration = max (never resets), start date
        c[0] = ZeroDustPermissionRouter.Caveat(
            PERIOD_ENFORCER, abi.encodePacked(allowance, type(uint256).max, block.timestamp), ""
        );
        c[1] = ZeroDustPermissionRouter.Caveat(EXACT_CALLDATA, "", "");
        c[2] = ZeroDustPermissionRouter.Caveat(
            TIMESTAMP, abi.encodePacked(uint128(0), uint128(block.timestamp + 600)), ""
        );
        c[3] = ZeroDustPermissionRouter.Caveat(REDEEMER, abi.encodePacked(redeemer), "");
        c[4] = ZeroDustPermissionRouter.Caveat(ALLOWED_TARGETS, abi.encodePacked(payee), "");
        c[5] = ZeroDustPermissionRouter.Caveat(NONCE, abi.encode(uint256(0)), "");
    }

    /// @dev A permission signed by `pk`, as MetaMask creates it, delegating to `delegate`
    function _permission(uint256 pk, address delegate, ZeroDustPermissionRouter.Caveat[] memory caveats)
        internal
        view
        returns (bytes memory)
    {
        ZeroDustPermissionRouter.Delegation memory d = ZeroDustPermissionRouter.Delegation({
            delegate: delegate,
            delegator: vm.addr(pk),
            authority: ROOT_AUTHORITY,
            caveats: caveats,
            salt: 1,
            signature: ""
        });
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", IDM(DM).getDomainHash(), IDM(DM).getDelegationHash(_toDm(d)))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        d.signature = abi.encodePacked(r, s, v);
        ZeroDustPermissionRouter.Delegation[] memory ds = new ZeroDustPermissionRouter.Delegation[](1);
        ds[0] = d;
        return abi.encode(ds);
    }

    function _toDm(ZeroDustPermissionRouter.Delegation memory d) internal pure returns (IDM.Delegation memory o) {
        IDM.Caveat[] memory cs = new IDM.Caveat[](d.caveats.length);
        for (uint256 i; i < cs.length; i++) {
            cs[i] = IDM.Caveat(d.caveats[i].enforcer, d.caveats[i].terms, d.caveats[i].args);
        }
        o = IDM.Delegation(d.delegate, d.delegator, d.authority, cs, d.salt, d.signature);
    }

    function _routerPermission(uint256 pk) internal view returns (bytes memory) {
        return _permission(pk, address(router), _caveats(vm.addr(pk).balance, address(router), address(router)));
    }

    /// @dev Reimbursement dominated by extraFeeWei: at 1 wei gas price the gas term is < 2M wei
    function _intent(address u, uint256 nonce) internal view returns (ZeroDustPermissionRouter.SweepIntent memory) {
        return ZeroDustPermissionRouter.SweepIntent({
            mode: 0,
            user: u,
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
            nonce: nonce
        });
    }

    function _sign(uint256 pk, ZeroDustPermissionRouter.SweepIntent memory s) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(pk, _digest(address(router), _one(s)));
        return abi.encodePacked(r, sg, v);
    }

    // ===== Batch signing (EIP-712 SweepBatch, computed here independently of the router) =====

    string constant INTENT_TYPE =
        "SweepIntent(uint8 mode,address user,address destination,uint256 destinationChainId,address callTarget,bytes32 routeHash,uint256 minReceive,uint256 maxTotalFeeWei,uint256 overheadGasUnits,uint256 protocolFeeGasUnits,uint256 extraFeeWei,uint256 reimbGasPriceCapWei,uint256 deadline,uint256 nonce)";

    function _structHashOf(ZeroDustPermissionRouter.SweepIntent memory s) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(bytes(INTENT_TYPE)),
                s.mode, s.user, s.destination, s.destinationChainId, s.callTarget, s.routeHash, s.minReceive,
                s.maxTotalFeeWei, s.overheadGasUnits, s.protocolFeeGasUnits, s.extraFeeWei, s.reimbGasPriceCapWei,
                s.deadline, s.nonce
            )
        );
    }

    /// @dev hashStruct(ChainSweep) for `s` on `chainId`
    function _leaf(uint256 chainId, ZeroDustPermissionRouter.SweepIntent memory s) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(abi.encodePacked("ChainSweep(uint256 chainId,SweepIntent intent)", INTENT_TYPE)), chainId, _structHashOf(s)));
    }

    /// @dev A batch of one: this chain's entry for `s`
    function _one(ZeroDustPermissionRouter.SweepIntent memory s) internal view returns (bytes32[] memory b) {
        b = new bytes32[](1);
        b[0] = _leaf(block.chainid, s);
    }

    /// @dev The digest MetaMask signs: no chainId in the domain, verifyingContract = the router
    function _digest(address routerAddr, bytes32[] memory batch) internal pure returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,address verifyingContract)"),
                keccak256("ZeroDust"),
                keccak256("permission-2"),
                routerAddr
            )
        );
        bytes32 batchHash = keccak256(abi.encode(keccak256(abi.encodePacked("SweepBatch(ChainSweep[] sweeps)ChainSweep(uint256 chainId,SweepIntent intent)", INTENT_TYPE)), keccak256(abi.encodePacked(batch))));
        return keccak256(abi.encodePacked("\x19\x01", domain, batchHash));
    }

    // ===== Happy paths =====

    function test_sweepsToExactlyZero_transfer() public onlyFork {
        bytes memory permission = _routerPermission(USER_PK);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        bytes memory sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        router.sweep(s, sig, "", permission, _one(s), 0);

        assertEq(user.balance, 0, "user must end at exactly 0");
        assertEq(destination.balance, 1 ether - s.maxTotalFeeWei, "destination gets balance - fee reserve");
        assertEq(sponsor.balance, s.maxTotalFeeWei, "sponsor gets the fee reserve");
        assertEq(address(router).balance, 0, "router keeps nothing");
        assertEq(router.nonces(user), 1);
    }

    function test_sweepsToExactlyZero_bridgeCall() public onlyFork {
        MockBridge bridge = new MockBridge();
        bytes memory callData = abi.encodeCall(MockBridge.deposit, (destination, 8453));
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        s.mode = 1;
        s.callTarget = address(bridge);
        s.routeHash = keccak256(callData);
        s.destinationChainId = 8453;
        bytes memory permission = _routerPermission(USER_PK);
        bytes memory sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        router.sweep(s, sig, callData, permission, _one(s), 0);

        assertEq(user.balance, 0);
        assertEq(address(bridge).balance, 1 ether - s.maxTotalFeeWei);
        assertEq(bridge.lastRecipient(), destination);
        assertEq(address(router).balance, 0);
    }

    function test_strayBalanceInRouterDoesNotBlockSweeps() public onlyFork {
        vm.deal(address(router), 7); // e.g. forced by a self-destruct
        bytes memory permission = _routerPermission(USER_PK);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        bytes memory sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        router.sweep(s, sig, "", permission, _one(s), 0);
        assertEq(user.balance, 0);
        assertEq(address(router).balance, 7);
    }

    // ===== Refusals =====

    function test_onlySponsor() public onlyFork {
        bytes memory permission = _routerPermission(USER_PK);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        bytes memory sig = _sign(USER_PK, s);
        vm.expectRevert(ZeroDustPermissionRouter.NotSponsor.selector);
        router.sweep(s, sig, "", permission, _one(s), 0);
    }

    function test_intentMustBeSignedByTheUser() public onlyFork {
        bytes memory permission = _routerPermission(USER_PK);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        bytes memory sig = _sign(OTHER_PK, s);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.InvalidSignature.selector);
        router.sweep(s, sig, "", permission, _one(s), 0);
    }

    function test_permissionMustBeTheIntentUsers() public onlyFork {
        // A valid intent from `user` paired with `other`'s permission
        bytes memory permission = _routerPermission(OTHER_PK);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        bytes memory sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.InvalidPermission.selector);
        router.sweep(s, sig, "", permission, _one(s), 0);
        assertEq(other.balance, 1 ether);
    }

    function test_permissionMustDelegateToTheRouter() public onlyFork {
        bytes memory permission =
            _permission(USER_PK, sponsor, _caveats(1 ether, address(router), address(router)));
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        bytes memory sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.InvalidPermission.selector);
        router.sweep(s, sig, "", permission, _one(s), 0);
    }

    function test_payeeOtherThanTheRouterIsRefusedByMetaMask() public onlyFork {
        bytes memory permission =
            _permission(USER_PK, address(router), _caveats(1 ether, destination, address(router)));
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        bytes memory sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        vm.expectRevert(); // AllowedTargetsEnforcer
        router.sweep(s, sig, "", permission, _one(s), 0);
        assertEq(user.balance, 1 ether);
    }

    function test_allowanceBelowTheBalanceRevertsAndMovesNothing() public onlyFork {
        // The wallet received more after granting: the permission cannot cover the balance
        bytes memory permission =
            _permission(USER_PK, address(router), _caveats(0.5 ether, address(router), address(router)));
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        bytes memory sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        vm.expectRevert();
        router.sweep(s, sig, "", permission, _one(s), 0);
        assertEq(user.balance, 1 ether);
    }

    function test_noReplay() public onlyFork {
        bytes memory permission = _routerPermission(USER_PK);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        bytes memory sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        router.sweep(s, sig, "", permission, _one(s), 0);
        vm.deal(user, 1 ether);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.NonceMismatch.selector);
        router.sweep(s, sig, "", permission, _one(s), 0);
    }

    function test_deadlines() public onlyFork {
        bytes memory permission = _routerPermission(USER_PK);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        s.deadline = block.timestamp + 61;
        bytes memory sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.DeadlineTooFar.selector);
        router.sweep(s, sig, "", permission, _one(s), 0);
        s.deadline = block.timestamp - 1;
        sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.DeadlineExpired.selector);
        router.sweep(s, sig, "", permission, _one(s), 0);
    }

    function test_routeHashBindsTheBridgeCall() public onlyFork {
        MockBridge bridge = new MockBridge();
        bytes memory callData = abi.encodeCall(MockBridge.deposit, (destination, 8453));
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        s.mode = 1;
        s.callTarget = address(bridge);
        s.routeHash = keccak256(callData);
        bytes memory sig = _sign(USER_PK, s);
        bytes memory permission = _routerPermission(USER_PK);
        bytes memory swapped = abi.encodeCall(MockBridge.deposit, (sponsor, 8453));
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.RouteHashMismatch.selector);
        router.sweep(s, sig, swapped, permission, _one(s), 0);
    }

    function test_feeAboveTheGuardrailIsRefused() public onlyFork {
        bytes memory permission = _routerPermission(USER_PK);
        ZeroDustPermissionRouter.SweepIntent memory s = _intent(user, 0);
        s.maxTotalFeeWei = 0.02 ether; // > 150% of the 0.01 ether reimbursement
        bytes memory sig = _sign(USER_PK, s);
        vm.prank(sponsor);
        vm.expectRevert(ZeroDustPermissionRouter.OverestimateTooHigh.selector);
        router.sweep(s, sig, "", permission, _one(s), 0);
    }

    function test_routerRefusesStrayTransfers() public onlyFork {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(router).call{ value: 1 }("");
        assertFalse(ok);
    }
}

contract MockBridge {
    address public lastRecipient;

    function deposit(address recipient, uint256) external payable {
        lastRecipient = recipient;
    }
}

interface IDM {
    struct Caveat {
        address enforcer;
        bytes terms;
        bytes args;
    }

    struct Delegation {
        address delegate;
        address delegator;
        bytes32 authority;
        Caveat[] caveats;
        uint256 salt;
        bytes signature;
    }

    function getDomainHash() external view returns (bytes32);
    function getDelegationHash(Delegation calldata) external pure returns (bytes32);
}
