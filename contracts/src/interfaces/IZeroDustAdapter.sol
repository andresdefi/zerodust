// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IZeroDustAdapter
 * @author ZeroDust
 * @notice Interface for bridge adapters used by ZeroDust cross-chain sweeps
 * @dev Adapters translate ZeroDust's semantic parameters into bridge-specific calls
 *
 * CRITICAL REQUIREMENTS FOR ADAPTERS:
 * 1. MUST NOT refund any value to msg.sender (the user's EOA under EIP-7702)
 *    - Refunds break the zero balance guarantee
 *    - All refunds MUST go to refundRecipient
 * 2. MUST honor the semantic parameters (destinationChainId, destination, minReceive)
 * 3. MUST revert if minReceive cannot be satisfied
 * 4. MUST consume all msg.value (send to bridge, no leftovers)
 *
 * ADAPTER DESIGN PATTERN:
 * - Each adapter wraps a specific bridge protocol (Bungee, Relay, Across, etc.)
 * - Adapters are immutable and audited
 * - New bridges require new adapter deployments
 * - ZeroDustSweepV2 maintains an allowlist of approved adapters
 */
interface IZeroDustAdapter {
    /**
     * @notice Execute a native token bridge to destination chain
     * @dev Called by ZeroDustSweepV2.executeCrossChainSweep()
     *
     * The adapter MUST:
     * - Forward all msg.value to the underlying bridge
     * - Configure the bridge to send funds to `destination` on `destinationChainId`
     * - Configure refunds to go to `refundRecipient` (NOT msg.sender)
     * - Revert if the bridge cannot guarantee >= minReceive on destination
     *
     * @param destinationChainId Target chain ID (signed by user)
     * @param destination Recipient address on destination chain (signed by user)
     * @param minReceive Minimum amount to receive on destination (signed by user, 0 = any)
     * @param refundRecipient Address for any bridge refunds (signed by user, equals relayer)
     * @param adapterData Bridge-specific routing data (quote response, route info, etc.)
     */
    function executeNativeBridge(
        uint256 destinationChainId,
        address destination,
        uint256 minReceive,
        address refundRecipient,
        bytes calldata adapterData
    ) external payable;

    /**
     * @notice Returns the name of the bridge this adapter wraps
     * @return Human-readable bridge name (e.g., "Bungee/Socket", "Relay", "Across")
     */
    function bridgeName() external view returns (string memory);

    /**
     * @notice Returns the list of destination chain IDs this adapter supports
     * @dev Used by frontend/backend to filter available routes
     * @return Array of supported chain IDs
     */
    function supportedChainIds() external view returns (uint256[] memory);

    /**
     * @notice Check if a specific destination chain is supported
     * @param chainId The chain ID to check
     * @return True if the adapter can bridge to this chain
     */
    function supportsChain(uint256 chainId) external view returns (bool);
}
