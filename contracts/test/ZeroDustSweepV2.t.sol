// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ZeroDustSweepV2} from "../src/ZeroDustSweepV2.sol";
import {IZeroDustAdapter} from "../src/interfaces/IZeroDustAdapter.sol";

/// @notice Mock adapter for testing cross-chain sweeps
contract MockAdapter is IZeroDustAdapter {
    bool public shouldFail;
    bool public shouldRefund;
    uint256 public lastDestinationChainId;
    address public lastDestination;
    uint256 public lastMinReceive;
    address public lastRefundRecipient;
    bytes public lastAdapterData;
    uint256 public lastValue;

    uint256[] private _supportedChains;

    constructor(uint256[] memory supportedChains) {
        _supportedChains = supportedChains;
    }

    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    function setShouldRefund(bool _shouldRefund) external {
        shouldRefund = _shouldRefund;
    }

    function executeNativeBridge(
        uint256 destinationChainId,
        address destination,
        uint256 minReceive,
        address refundRecipient,
        bytes calldata adapterData
    ) external payable override {
        if (shouldFail) revert("MockAdapter: forced failure");

        lastDestinationChainId = destinationChainId;
        lastDestination = destination;
        lastMinReceive = minReceive;
        lastRefundRecipient = refundRecipient;
        lastAdapterData = adapterData;
        lastValue = msg.value;

        // Simulate refund behavior (would break zero balance)
        if (shouldRefund) {
            (bool success,) = msg.sender.call{value: msg.value / 10}("");
            require(success, "refund failed");
        }
    }

    function bridgeName() external pure override returns (string memory) {
        return "MockAdapter";
    }

    function supportedChainIds() external view override returns (uint256[] memory) {
        return _supportedChains;
    }

    function supportsChain(uint256 chainId) external view override returns (bool) {
        for (uint256 i = 0; i < _supportedChains.length; i++) {
            if (_supportedChains[i] == chainId) return true;
        }
        return false;
    }
}

/// @notice Contract that rejects ETH transfers
contract RejectingContract {
    receive() external payable {
        revert("I reject ETH");
    }
}

/// @notice Contract that accepts ETH
contract AcceptingContract {
    receive() external payable {}
}

contract ZeroDustSweepV2Test is Test {
    ZeroDustSweepV2 public sweep;
    MockAdapter public mockAdapter;
    MockAdapter public mockAdapter2;

    // Test accounts
    address public user;
    uint256 public userPrivateKey;
    address public relayer;
    address public destination;

    // EIP-712 constants
    bytes32 public constant SAME_CHAIN_SWEEP_TYPEHASH = keccak256(
        "SameChainSweep(address user,address destination,address relayer,uint256 maxRelayerFee,uint256 deadline,uint256 nonce)"
    );
    bytes32 public constant CROSS_CHAIN_SWEEP_TYPEHASH = keccak256(
        "CrossChainSweep(address user,uint256 destinationChainId,address destination,address relayer,address adapter,address refundRecipient,uint256 maxRelayerFee,uint256 minReceive,uint256 deadline,uint256 nonce)"
    );

    // Destination chain ID for cross-chain tests
    uint256 public constant DEST_CHAIN_ID = 137; // Polygon

    function setUp() public {
        // Create test accounts
        userPrivateKey = 0xA11CE;
        user = vm.addr(userPrivateKey);
        relayer = makeAddr("relayer");
        destination = makeAddr("destination");

        // Deploy on a different chain ID first
        // This ensures INITIAL_CHAIN_ID != test chain ID
        vm.chainId(1);

        // Deploy mock adapters
        uint256[] memory supportedChains = new uint256[](3);
        supportedChains[0] = 137;  // Polygon
        supportedChains[1] = 42161; // Arbitrum
        supportedChains[2] = 8453;  // Base
        mockAdapter = new MockAdapter(supportedChains);
        mockAdapter2 = new MockAdapter(supportedChains);

        // Deploy sweep contract with adapters
        address[] memory adapters = new address[](2);
        adapters[0] = address(mockAdapter);
        adapters[1] = address(mockAdapter2);
        sweep = new ZeroDustSweepV2(adapters);

        // Fund relayer for gas
        vm.deal(relayer, 10 ether);

        // IMPORTANT: Change chain ID to force domain separator recomputation
        // Under EIP-7702, address(this) is the user's address, not the implementation.
        // The cached INITIAL_DOMAIN_SEPARATOR was computed with implementation address.
        // By changing chainId, we force _domainSeparator() to call _computeDomainSeparator()
        // which uses address(this) = user (correct for EIP-7702).
        vm.chainId(31337);
    }

    // ============ Helper Functions ============

    function _computeDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ZeroDust"),
                keccak256("2"),
                block.chainid,
                user // Under EIP-7702, verifyingContract is user's address
            )
        );
    }

    function _signSameChainSweep(
        ZeroDustSweepV2.SameChainSweep memory sweepData
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                SAME_CHAIN_SWEEP_TYPEHASH,
                sweepData.user,
                sweepData.destination,
                sweepData.relayer,
                sweepData.maxRelayerFee,
                sweepData.deadline,
                sweepData.nonce
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _computeDomainSeparator(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signCrossChainSweep(
        ZeroDustSweepV2.CrossChainSweep memory sweepData
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                CROSS_CHAIN_SWEEP_TYPEHASH,
                sweepData.user,
                sweepData.destinationChainId,
                sweepData.destination,
                sweepData.relayer,
                sweepData.adapter,
                sweepData.refundRecipient,
                sweepData.maxRelayerFee,
                sweepData.minReceive,
                sweepData.deadline,
                sweepData.nonce
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _computeDomainSeparator(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsAdapters() public view {
        assertEq(sweep.adapterCount(), 2);
        assertTrue(sweep.isAllowedAdapter(address(mockAdapter)));
        assertTrue(sweep.isAllowedAdapter(address(mockAdapter2)));
        assertFalse(sweep.isAllowedAdapter(address(0x1234)));
    }

    function test_constructor_setsDomainSeparator() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ZeroDust"),
                keccak256("2"),
                block.chainid,
                address(sweep)
            )
        );
        assertEq(sweep.DOMAIN_SEPARATOR(), expected);
    }

    function test_constructor_reverts_tooManyAdapters() public {
        address[] memory adapters = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            adapters[i] = address(uint160(i + 1));
        }
        vm.expectRevert(ZeroDustSweepV2.TooManyAdapters.selector);
        new ZeroDustSweepV2(adapters);
    }

    function test_constructor_reverts_zeroAdapter() public {
        address[] memory adapters = new address[](2);
        adapters[0] = address(mockAdapter);
        adapters[1] = address(0);
        vm.expectRevert(ZeroDustSweepV2.ZeroAdapter.selector);
        new ZeroDustSweepV2(adapters);
    }

    function test_constructor_reverts_duplicateAdapter() public {
        address[] memory adapters = new address[](2);
        adapters[0] = address(mockAdapter);
        adapters[1] = address(mockAdapter);
        vm.expectRevert(ZeroDustSweepV2.DuplicateAdapter.selector);
        new ZeroDustSweepV2(adapters);
    }

    function test_getAllowedAdapters() public view {
        address[] memory adapters = sweep.getAllowedAdapters();
        assertEq(adapters.length, 2);
        assertEq(adapters[0], address(mockAdapter));
        assertEq(adapters[1], address(mockAdapter2));
    }

    // ============ Same-Chain Sweep Tests ============

    function test_sameChainSweep_success() public {
        uint256 userBalance = 1 ether;
        uint256 maxRelayerFee = 0.01 ether;

        // Setup: delegate user's EOA to sweep contract
        vm.etch(user, address(sweep).code);
        vm.deal(user, userBalance);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: maxRelayerFee,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        uint256 destBalanceBefore = destination.balance;
        uint256 relayerBalanceBefore = relayer.balance;

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);

        // Verify balances
        assertEq(user.balance, 0, "User balance should be zero");
        assertEq(destination.balance, destBalanceBefore + userBalance - maxRelayerFee, "Destination should receive funds");
        assertEq(relayer.balance, relayerBalanceBefore + maxRelayerFee, "Relayer should receive fee");
    }

    function test_sameChainSweep_permissionless() public {
        uint256 userBalance = 1 ether;
        uint256 maxRelayerFee = 0.01 ether;

        vm.etch(user, address(sweep).code);
        vm.deal(user, userBalance);

        // relayer = address(0) means anyone can execute
        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: address(0), // Permissionless
            maxRelayerFee: maxRelayerFee,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        address randomExecutor = makeAddr("random");
        vm.deal(randomExecutor, 1 ether);

        vm.prank(randomExecutor);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);

        assertEq(user.balance, 0);
    }

    function test_sameChainSweep_zeroRelayerFee() public {
        uint256 userBalance = 1 ether;

        vm.etch(user, address(sweep).code);
        vm.deal(user, userBalance);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0, // No fee
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);

        assertEq(user.balance, 0);
        assertEq(destination.balance, userBalance);
    }

    function test_sameChainSweep_feeExceedsBalance() public {
        uint256 userBalance = 0.005 ether;
        uint256 maxRelayerFee = 0.01 ether; // More than balance

        vm.etch(user, address(sweep).code);
        vm.deal(user, userBalance);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: maxRelayerFee,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        uint256 relayerBalanceBefore = relayer.balance;

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);

        // Fee is capped at balance
        assertEq(user.balance, 0);
        assertEq(relayer.balance, relayerBalanceBefore + userBalance);
        assertEq(destination.balance, 0);
    }

    function test_sameChainSweep_incrementsNonce() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        assertEq(ZeroDustSweepV2(payable(user)).nextNonce(), 0);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);

        assertEq(ZeroDustSweepV2(payable(user)).nextNonce(), 1);
    }

    function test_sameChainSweep_emitsEvent() public {
        uint256 userBalance = 1 ether;
        uint256 maxRelayerFee = 0.01 ether;

        vm.etch(user, address(sweep).code);
        vm.deal(user, userBalance);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: maxRelayerFee,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        vm.expectEmit(true, true, false, true);
        emit ZeroDustSweepV2.SameChainSweepExecuted(
            user,
            destination,
            userBalance - maxRelayerFee,
            maxRelayerFee,
            relayer,
            0
        );

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);
    }

    // ============ Same-Chain Sweep Revert Tests ============

    function test_sameChainSweep_reverts_invalidExecutionContext() public {
        // Don't etch - user is still EOA, not delegated
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        // Call directly on sweep contract (not via user's delegated EOA)
        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidExecutionContext.selector);
        sweep.executeSameChainSweep(sweepData, signature);
    }

    function test_sameChainSweep_reverts_expiredDeadline() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp - 1, // Expired
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.DeadlineExpired.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);
    }

    function test_sameChainSweep_reverts_invalidNonce() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 1 // Should be 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidNonce.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);
    }

    function test_sameChainSweep_reverts_zeroDestination() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: address(0), // Invalid
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidDestination.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);
    }

    function test_sameChainSweep_reverts_selfDestination() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: user, // Self-transfer not allowed
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidDestination.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);
    }

    function test_sameChainSweep_reverts_unauthorizedRelayer() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer, // Specific relayer required
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        address wrongRelayer = makeAddr("wrong");
        vm.deal(wrongRelayer, 1 ether);

        vm.prank(wrongRelayer);
        vm.expectRevert(ZeroDustSweepV2.UnauthorizedRelayer.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);
    }

    function test_sameChainSweep_reverts_invalidSignature() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        // Sign with wrong key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, keccak256("wrong"));
        bytes memory badSignature = abi.encodePacked(r, s, v);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidSignature.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, badSignature);
    }

    function test_sameChainSweep_reverts_zeroBalance() public {
        vm.etch(user, address(sweep).code);
        // Don't fund user - balance is 0

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.ZeroBalance.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);
    }

    function test_sameChainSweep_reverts_destinationRejectsETH() public {
        RejectingContract rejecter = new RejectingContract();

        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: address(rejecter),
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.TransferFailed.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);
    }

    // ============ Cross-Chain Sweep Tests ============

    function test_crossChainSweep_success() public {
        uint256 userBalance = 1 ether;
        uint256 maxRelayerFee = 0.01 ether;
        uint256 minReceive = 0.9 ether;

        vm.etch(user, address(sweep).code);
        vm.deal(user, userBalance);

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: destination,
            relayer: relayer,
            adapter: address(mockAdapter),
            refundRecipient: relayer, // Must equal relayer
            maxRelayerFee: maxRelayerFee,
            minReceive: minReceive,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);
        bytes memory adapterData = hex"1234";

        uint256 relayerBalanceBefore = relayer.balance;

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, adapterData);

        // Verify user balance is zero
        assertEq(user.balance, 0, "User balance should be zero");

        // Verify relayer received fee
        assertEq(relayer.balance, relayerBalanceBefore + maxRelayerFee, "Relayer should receive fee");

        // Verify adapter was called correctly
        assertEq(mockAdapter.lastDestinationChainId(), DEST_CHAIN_ID);
        assertEq(mockAdapter.lastDestination(), destination);
        assertEq(mockAdapter.lastMinReceive(), minReceive);
        assertEq(mockAdapter.lastRefundRecipient(), relayer);
        assertEq(mockAdapter.lastValue(), userBalance - maxRelayerFee);
    }

    function test_crossChainSweep_emitsEvent() public {
        uint256 userBalance = 1 ether;
        uint256 maxRelayerFee = 0.01 ether;
        uint256 minReceive = 0.9 ether;

        vm.etch(user, address(sweep).code);
        vm.deal(user, userBalance);

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: destination,
            relayer: relayer,
            adapter: address(mockAdapter),
            refundRecipient: relayer,
            maxRelayerFee: maxRelayerFee,
            minReceive: minReceive,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);

        vm.expectEmit(true, true, false, true);
        emit ZeroDustSweepV2.CrossChainSweepExecuted(
            user,
            DEST_CHAIN_ID,
            destination,
            address(mockAdapter),
            relayer,
            userBalance - maxRelayerFee,
            maxRelayerFee,
            minReceive,
            relayer,
            0
        );

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, hex"");
    }

    function test_crossChainSweep_withSecondAdapter() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: destination,
            relayer: relayer,
            adapter: address(mockAdapter2), // Second adapter
            refundRecipient: relayer,
            maxRelayerFee: 0.01 ether,
            minReceive: 0.9 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, hex"");

        assertEq(user.balance, 0);
        assertEq(mockAdapter2.lastDestinationChainId(), DEST_CHAIN_ID);
    }

    // ============ Cross-Chain Sweep Revert Tests ============

    function test_crossChainSweep_reverts_noRelayer() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: destination,
            relayer: address(0), // Not allowed for cross-chain
            adapter: address(mockAdapter),
            refundRecipient: address(0),
            maxRelayerFee: 0.01 ether,
            minReceive: 0.9 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidRefundRecipient.selector);
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, hex"");
    }

    function test_crossChainSweep_reverts_refundRecipientNotRelayer() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: destination,
            relayer: relayer,
            adapter: address(mockAdapter),
            refundRecipient: destination, // Must be relayer
            maxRelayerFee: 0.01 ether,
            minReceive: 0.9 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidRefundRecipient.selector);
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, hex"");
    }

    function test_crossChainSweep_reverts_invalidAdapter() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        address fakeAdapter = makeAddr("fake");

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: destination,
            relayer: relayer,
            adapter: fakeAdapter, // Not in allowlist
            refundRecipient: relayer,
            maxRelayerFee: 0.01 ether,
            minReceive: 0.9 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidAdapter.selector);
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, hex"");
    }

    function test_crossChainSweep_reverts_adapterFails() public {
        mockAdapter.setShouldFail(true);

        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: destination,
            relayer: relayer,
            adapter: address(mockAdapter),
            refundRecipient: relayer,
            maxRelayerFee: 0.01 ether,
            minReceive: 0.9 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.AdapterCallFailed.selector);
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, hex"");
    }

    function test_crossChainSweep_reverts_adapterRefunds() public {
        mockAdapter.setShouldRefund(true);

        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: destination,
            relayer: relayer,
            adapter: address(mockAdapter),
            refundRecipient: relayer,
            maxRelayerFee: 0.01 ether,
            minReceive: 0.9 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.NonZeroRemainder.selector);
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, hex"");
    }

    function test_crossChainSweep_reverts_zeroDestination() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: address(0), // Invalid
            relayer: relayer,
            adapter: address(mockAdapter),
            refundRecipient: relayer,
            maxRelayerFee: 0.01 ether,
            minReceive: 0.9 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidDestination.selector);
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, hex"");
    }

    // ============ Signature Tests ============

    function test_signature_reverts_wrongLength() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory shortSignature = hex"1234"; // Too short

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidSignature.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, shortSignature);
    }

    function test_signature_reverts_highS() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        // Create signature with high-s value
        bytes32 r = bytes32(uint256(1));
        bytes32 highS = bytes32(0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A1); // MAX_S + 1
        bytes memory badSignature = abi.encodePacked(r, highS, uint8(27));

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidSignature.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, badSignature);
    }

    function test_signature_reverts_zeroR() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes32 zeroR = bytes32(0);
        bytes32 s = bytes32(uint256(1));
        bytes memory badSignature = abi.encodePacked(zeroR, s, uint8(27));

        vm.prank(relayer);
        vm.expectRevert(ZeroDustSweepV2.InvalidSignature.selector);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, badSignature);
    }

    function test_signature_acceptsV0V1() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes32 structHash = keccak256(
            abi.encode(
                SAME_CHAIN_SWEEP_TYPEHASH,
                sweepData.user,
                sweepData.destination,
                sweepData.relayer,
                sweepData.maxRelayerFee,
                sweepData.deadline,
                sweepData.nonce
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _computeDomainSeparator(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);

        // Use v=0 instead of v=27
        uint8 v0 = v == 27 ? 0 : 1;
        bytes memory signatureWithV0 = abi.encodePacked(r, s, v0);

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signatureWithV0);

        assertEq(user.balance, 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_sameChainSweep_compensationCalculation(
        uint256 balance,
        uint256 maxFee
    ) public {
        balance = bound(balance, 1, 100 ether);
        maxFee = bound(maxFee, 0, 100 ether);

        vm.etch(user, address(sweep).code);
        vm.deal(user, balance);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: maxFee,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        uint256 expectedFee = balance > maxFee ? maxFee : balance;
        uint256 expectedDest = balance - expectedFee;

        uint256 destBefore = destination.balance;
        uint256 relayerBefore = relayer.balance;

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);

        assertEq(user.balance, 0, "User should have zero balance");
        assertEq(destination.balance - destBefore, expectedDest, "Destination balance incorrect");
        assertEq(relayer.balance - relayerBefore, expectedFee, "Relayer balance incorrect");
    }

    function testFuzz_crossChainSweep_adapterReceivesCorrectValue(
        uint256 balance,
        uint256 maxFee
    ) public {
        balance = bound(balance, 1, 100 ether);
        maxFee = bound(maxFee, 0, balance);

        vm.etch(user, address(sweep).code);
        vm.deal(user, balance);

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: destination,
            relayer: relayer,
            adapter: address(mockAdapter),
            refundRecipient: relayer,
            maxRelayerFee: maxFee,
            minReceive: 0,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);

        vm.prank(relayer);
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, hex"");

        assertEq(user.balance, 0);
        assertEq(mockAdapter.lastValue(), balance - maxFee);
    }

    // ============ View Function Tests ============

    function test_nextNonce_startsAtZero() public {
        vm.etch(user, address(sweep).code);
        assertEq(ZeroDustSweepV2(payable(user)).nextNonce(), 0);
    }

    function test_DOMAIN_SEPARATOR_recomputesOnFork() public {
        bytes32 originalSeparator = sweep.DOMAIN_SEPARATOR();

        // Simulate fork by changing chain ID
        vm.chainId(999);

        bytes32 newSeparator = sweep.DOMAIN_SEPARATOR();

        // Should be different due to different chainId
        assertTrue(newSeparator != originalSeparator);
    }

    // ============ Gas Tests ============

    function test_gasUsage_sameChainSweep() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.SameChainSweep memory sweepData = ZeroDustSweepV2.SameChainSweep({
            user: user,
            destination: destination,
            relayer: relayer,
            maxRelayerFee: 0.01 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signSameChainSweep(sweepData);

        vm.prank(relayer);
        uint256 gasBefore = gasleft();
        ZeroDustSweepV2(payable(user)).executeSameChainSweep(sweepData, signature);
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Gas used for same-chain sweep:", gasUsed);
        assertTrue(gasUsed < 150000, "Gas usage too high");
    }

    function test_gasUsage_crossChainSweep() public {
        vm.etch(user, address(sweep).code);
        vm.deal(user, 1 ether);

        ZeroDustSweepV2.CrossChainSweep memory sweepData = ZeroDustSweepV2.CrossChainSweep({
            user: user,
            destinationChainId: DEST_CHAIN_ID,
            destination: destination,
            relayer: relayer,
            adapter: address(mockAdapter),
            refundRecipient: relayer,
            maxRelayerFee: 0.01 ether,
            minReceive: 0.9 ether,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });

        bytes memory signature = _signCrossChainSweep(sweepData);

        vm.prank(relayer);
        uint256 gasBefore = gasleft();
        ZeroDustSweepV2(payable(user)).executeCrossChainSweep(sweepData, signature, hex"");
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Gas used for cross-chain sweep:", gasUsed);
        assertTrue(gasUsed < 200000, "Gas usage too high");
    }
}
