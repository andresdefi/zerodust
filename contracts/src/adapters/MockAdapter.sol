// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IZeroDustAdapter} from "../interfaces/IZeroDustAdapter.sol";

/// @title MockAdapter
/// @notice A mock bridge adapter for testing cross-chain sweep flows
/// @dev This adapter simulates a bridge by holding the funds. In production,
///      use a real adapter like BungeeAdapter that forwards to actual bridges.
///
/// TESTNET ONLY - DO NOT USE IN PRODUCTION
///
/// This adapter is useful for:
/// - Testing V2 cross-chain sweep signature verification
/// - Testing adapter allowlist enforcement
/// - Testing relayer pinning requirements
/// - Integration testing before mainnet deployment
contract MockAdapter is IZeroDustAdapter {
    /// @notice Emitted when a mock bridge is executed
    /// @param destinationChainId The target chain ID
    /// @param destination The recipient on the destination chain
    /// @param amount The amount of native token bridged
    /// @param refundRecipient The address to receive refunds
    event MockBridgeExecuted(
        uint256 indexed destinationChainId,
        address indexed destination,
        uint256 amount,
        address refundRecipient
    );

    /// @notice The address that receives "bridged" funds (for testing)
    address public immutable treasury;

    /// @notice Track total bridged amount (for testing verification)
    uint256 public totalBridged;

    /// @notice Track bridge count (for testing verification)
    uint256 public bridgeCount;

    /// @notice Supported chain IDs for mock bridging
    uint256[] private _supportedChainIds;

    /// @param _treasury Address to receive funds (simulates bridge escrow)
    constructor(address _treasury) {
        require(_treasury != address(0), "MockAdapter: zero treasury");
        treasury = _treasury;

        // Support common testnet chain IDs
        _supportedChainIds.push(1);        // Ethereum
        _supportedChainIds.push(11155111); // Sepolia
        _supportedChainIds.push(84532);    // Base Sepolia
        _supportedChainIds.push(421614);   // Arbitrum Sepolia
        _supportedChainIds.push(11155420); // Optimism Sepolia
        _supportedChainIds.push(80002);    // Polygon Amoy
    }

    /// @inheritdoc IZeroDustAdapter
    /// @notice Simulates a bridge by sending funds to the treasury
    /// @dev In production, this would call a real bridge protocol
    function executeNativeBridge(
        uint256 destinationChainId,
        address destination,
        uint256 minReceive,
        address refundRecipient,
        bytes calldata /* adapterData - ignored in mock */
    ) external payable override {
        require(msg.value > 0, "MockAdapter: zero value");
        require(destination != address(0), "MockAdapter: zero destination");
        require(msg.value >= minReceive, "MockAdapter: insufficient for minReceive");

        // Send funds to treasury (simulates bridge escrow)
        (bool success,) = treasury.call{value: msg.value}("");
        require(success, "MockAdapter: treasury transfer failed");

        // Update tracking
        totalBridged += msg.value;
        bridgeCount++;

        emit MockBridgeExecuted(
            destinationChainId,
            destination,
            msg.value,
            refundRecipient
        );
    }

    /// @inheritdoc IZeroDustAdapter
    function bridgeName() external pure override returns (string memory) {
        return "MockBridge (Testing Only)";
    }

    /// @inheritdoc IZeroDustAdapter
    function supportedChainIds() external view override returns (uint256[] memory) {
        return _supportedChainIds;
    }

    /// @inheritdoc IZeroDustAdapter
    function supportsChain(uint256 chainId) external view override returns (bool) {
        for (uint256 i = 0; i < _supportedChainIds.length; i++) {
            if (_supportedChainIds[i] == chainId) {
                return true;
            }
        }
        return false;
    }

    /// @notice Allows treasury to withdraw funds (for testing cleanup)
    function withdrawToTreasury() external {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success,) = treasury.call{value: balance}("");
            require(success, "MockAdapter: withdraw failed");
        }
    }

    /// @notice Accept ETH (in case of refunds during testing)
    receive() external payable {}
}
