// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IZeroDustAdapter} from "../interfaces/IZeroDustAdapter.sol";

/**
 * @title BungeeAdapter
 * @author ZeroDust
 * @notice Adapter for bridging native tokens via Bungee Auto (Inbox Contract)
 * @dev Translates ZeroDust semantic parameters into BungeeInbox calls
 *
 * BUNGEE AUTO OVERVIEW:
 * - Bungee Auto is an auction-based bridge aggregator
 * - Solvers compete to fulfill cross-chain requests at optimal prices
 * - The BungeeInbox contract receives requests and triggers the auction
 * - This adapter forwards the request calldata to the inbox
 *
 * FLOW:
 * 1. User signs ZeroDust sweep authorization
 * 2. Backend calls Bungee Quote API to get pricing
 * 3. Backend calls Bungee build-tx API to get transaction data
 * 4. Relayer executes sweep, adapter forwards calldata to BungeeInbox
 * 5. Solvers compete in auction to fulfill the request
 * 6. Winner delivers funds on destination chain
 *
 * BACKEND RESPONSIBILITY:
 * The ZeroDust backend MUST:
 * 1. Call Bungee Quote API: GET /api/v1/bungee/quote
 * 2. Call Bungee build-tx API: GET /api/v1/bungee/build-tx
 * 3. Ensure the quote's recipient matches `destination`
 * 4. Ensure the quote's toChainId matches `destinationChainId`
 * 5. Ensure the quote respects `minReceive` via minOutputAmount
 * 6. Pass the returned txData.data as `adapterData` to this adapter
 *
 * BUNGEE API EXAMPLE:
 * ```
 * // Step 1: Get quote
 * GET https://dedicated-backend.bungee.exchange/api/v1/bungee/quote
 *   ?fromChainId=1
 *   &toChainId=137
 *   &fromTokenAddress=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
 *   &toTokenAddress=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
 *   &fromAmount=1000000000000000000
 *   &userAddress=<user_eoa>
 *   &recipient=<destination>
 * Headers: x-api-key: <your_api_key>
 *
 * // Step 2: Build transaction
 * GET https://dedicated-backend.bungee.exchange/api/v1/bungee/build-tx
 *   ?quoteId=<quote_id_from_step_1>
 * Headers: x-api-key: <your_api_key>
 *
 * // Response contains: { txData: { to, value, data } }
 * // Pass txData.data as adapterData
 * ```
 *
 * MAINNET BUNGEE INBOX ADDRESSES:
 * - Ethereum:  0x92612711D4d07dEbe4964D4d1401D7d7B5a11737
 * - Arbitrum:  0xA3BF43451CdEb6DEC588B8833838fC419CE4F54c
 * - Base:      0x3C54883Ce0d86b3abB26A63744bEb853Ea99a403
 * - Optimism:  0x78255f1DeE074fb7084Ee124058A058dE0B1C251
 * - Polygon:   0xFEfFE1D89542C111845648a107811Fb272EaE0Da
 * - BSC:       0x002cd45978F556D817e5FBB4020f7Dd82Bb10941
 *
 * STATUS TRACKING:
 * After submission, track status via:
 * GET /api/v1/bungee/status?requestHash=<hash>
 *
 * Status codes:
 * 0=PENDING, 1=ASSIGNED, 2=EXTRACTED, 3=FULFILLED, 4=SETTLED
 * 5=EXPIRED, 6=CANCELLED, 7=REFUNDED
 */
contract BungeeAdapter is IZeroDustAdapter {
    // ============ Constants ============

    /// @notice Native token address used by Bungee API
    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // ============ Immutables ============

    /// @notice BungeeInbox contract address for this chain
    address public immutable bungeeInbox;

    /// @notice Chain ID this adapter is deployed on
    uint256 public immutable sourceChainId;

    // ============ State ============

    /// @notice Supported destination chain IDs
    uint256[] private _supportedChainIds;

    // ============ Errors ============

    /// @notice Thrown when inbox call fails
    error BridgeCallFailed();

    /// @notice Thrown when adapterData is empty
    error EmptyRouteData();

    /// @notice Thrown when msg.value is zero
    error ZeroValue();

    /// @notice Thrown when destination chain is not supported
    error UnsupportedChain(uint256 chainId);

    // ============ Constructor ============

    /**
     * @notice Deploy adapter with BungeeInbox address and supported chains
     * @param _bungeeInbox Address of BungeeInbox on this chain
     * @param _supportedChains Array of destination chain IDs this adapter supports
     */
    constructor(address _bungeeInbox, uint256[] memory _supportedChains) {
        require(_bungeeInbox != address(0), "Zero inbox");
        require(_supportedChains.length > 0, "No chains");

        bungeeInbox = _bungeeInbox;
        sourceChainId = block.chainid;
        _supportedChainIds = _supportedChains;
    }

    // ============ External Functions ============

    /**
     * @notice Execute native token bridge via BungeeInbox
     * @dev Called by ZeroDustSweepV2.executeCrossChainSweep()
     *
     * The adapterData MUST contain valid Bungee request calldata that:
     * - Routes to `destination` on `destinationChainId`
     * - Has minOutputAmount >= `minReceive`
     *
     * This adapter trusts the backend to provide correct request data.
     * The BungeeInbox will process the request and trigger solver auction.
     *
     * @param destinationChainId Target chain ID (verified against supported chains)
     * @param destination Recipient on destination (encoded in adapterData by backend)
     * @param minReceive Minimum output amount (encoded in adapterData by backend)
     * @param refundRecipient Refund address (handled by Bungee's refund mechanism)
     * @param adapterData Pre-computed Bungee request calldata from backend (txData.data)
     */
    function executeNativeBridge(
        uint256 destinationChainId,
        address destination,
        uint256 minReceive,
        address refundRecipient,
        bytes calldata adapterData
    ) external payable override {
        // Validate inputs
        if (msg.value == 0) revert ZeroValue();
        if (adapterData.length == 0) revert EmptyRouteData();
        if (!supportsChain(destinationChainId)) revert UnsupportedChain(destinationChainId);

        // Silence unused variable warnings - these are encoded in adapterData
        // The backend is responsible for ensuring adapterData matches these params
        (destination, minReceive, refundRecipient);

        // Forward entire msg.value to BungeeInbox with request calldata
        // The inbox will process the request and trigger solver auction
        (bool success,) = bungeeInbox.call{value: msg.value}(adapterData);
        if (!success) revert BridgeCallFailed();
    }

    // ============ View Functions ============

    /**
     * @notice Returns the bridge name
     * @return "Bungee Auto"
     */
    function bridgeName() external pure override returns (string memory) {
        return "Bungee Auto";
    }

    /**
     * @notice Returns all supported destination chain IDs
     * @return Array of chain IDs
     */
    function supportedChainIds() external view override returns (uint256[] memory) {
        return _supportedChainIds;
    }

    /**
     * @notice Check if a destination chain is supported
     * @param chainId Chain ID to check
     * @return True if supported
     */
    function supportsChain(uint256 chainId) public view override returns (bool) {
        uint256 length = _supportedChainIds.length;
        for (uint256 i = 0; i < length;) {
            if (_supportedChainIds[i] == chainId) return true;
            unchecked { ++i; }
        }
        return false;
    }

    // ============ Receive ============

    /// @notice Reject direct ETH transfers (must go through executeNativeBridge)
    receive() external payable {
        revert();
    }
}
