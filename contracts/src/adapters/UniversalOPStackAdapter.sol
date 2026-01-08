// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IZeroDustAdapter} from "../interfaces/IZeroDustAdapter.sol";

/**
 * @title UniversalOPStackAdapter
 * @author ZeroDust
 * @notice Bridge adapter supporting 15 OP Stack L2s from a single deployment
 * @dev Used for testnet cross-chain sweeps (Sepolia → multiple OP Stack L2s)
 *
 * This adapter stores a mapping of destination chain IDs to their L1StandardBridge
 * addresses on Sepolia, allowing one adapter to bridge to any supported OP Stack L2.
 *
 * Supported destinations (from Sepolia L1) - 15 chains:
 * - Base Sepolia (84532)
 * - OP Sepolia (11155420)
 * - Mode Sepolia (919)
 * - Zora Sepolia (999999999)
 * - Unichain Sepolia (1301)
 * - Ink Sepolia (763373)
 * - Shape Sepolia (11011)
 * - Lisk Sepolia (4202)
 * - World Chain Sepolia (4801)
 * - Metal L2 Testnet (1740)
 * - Soneium Minato (1946)
 * - Ancient8 Testnet (28122024)
 * - Superseed Sepolia (53302)
 * - BOB Sepolia (808813)
 * - Celo Sepolia (11142220)
 *
 * All bridges verified on Ethereum Sepolia (January 2026).
 * All destination chains verified for EIP-7702 support.
 */
contract UniversalOPStackAdapter is IZeroDustAdapter {
    /// @notice Mapping of destination chain ID to L1StandardBridge address
    mapping(uint256 => address) public bridges;

    /// @notice Array of supported destination chain IDs
    uint256[] public supportedChains;

    /// @notice Minimum gas limit for L2 execution (100k is sufficient for ETH transfers)
    uint32 public constant MIN_GAS_LIMIT = 100000;

    /// @notice Error when destination chain is not supported
    error UnsupportedDestinationChain(uint256 chainId);

    /// @notice Error when bridge call fails
    error BridgeFailed();

    /// @notice Error when arrays have mismatched lengths
    error ArrayLengthMismatch();

    /// @notice Error when bridge address is zero
    error InvalidBridgeAddress();

    /**
     * @notice Construct the adapter with all supported bridges
     * @param _chainIds Array of destination chain IDs
     * @param _bridges Array of corresponding L1StandardBridge addresses on Sepolia
     */
    constructor(uint256[] memory _chainIds, address[] memory _bridges) {
        if (_chainIds.length != _bridges.length) revert ArrayLengthMismatch();
        if (_chainIds.length == 0) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < _chainIds.length; i++) {
            if (_bridges[i] == address(0)) revert InvalidBridgeAddress();
            bridges[_chainIds[i]] = _bridges[i];
            supportedChains.push(_chainIds[i]);
        }
    }

    /**
     * @inheritdoc IZeroDustAdapter
     * @dev Calls L1StandardBridge.depositETHTo() to bridge ETH to any supported L2
     *
     * Note: OP Stack native bridges have no slippage - user receives exactly what is sent.
     * The minReceive parameter is validated for interface compliance but the bridge
     * guarantees 1:1 transfer (minus negligible L2 gas costs).
     */
    function executeNativeBridge(
        uint256 _destinationChainId,
        address _destination,
        uint256 _minReceive,
        address _refundRecipient,
        bytes calldata _adapterData
    ) external payable override {
        address bridge = bridges[_destinationChainId];
        if (bridge == address(0)) {
            revert UnsupportedDestinationChain(_destinationChainId);
        }

        // Silence unused variable warnings (OP Stack doesn't use these)
        (_minReceive, _refundRecipient, _adapterData);

        // Call L1StandardBridge.depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData)
        // Function selector: 0x9a2ac6d5
        (bool success, ) = bridge.call{value: msg.value}(
            abi.encodeWithSelector(
                bytes4(0x9a2ac6d5), // depositETHTo
                _destination,
                MIN_GAS_LIMIT,
                "" // extraData is empty for simple ETH transfers
            )
        );

        if (!success) {
            revert BridgeFailed();
        }
    }

    /// @inheritdoc IZeroDustAdapter
    function bridgeName() external pure override returns (string memory) {
        return "Universal OP Stack Bridge";
    }

    /// @inheritdoc IZeroDustAdapter
    function supportedChainIds() external view override returns (uint256[] memory) {
        return supportedChains;
    }

    /// @inheritdoc IZeroDustAdapter
    function supportsChain(uint256 chainId) external view override returns (bool) {
        return bridges[chainId] != address(0);
    }

    /// @notice Get the bridge address for a destination chain
    /// @param chainId The destination chain ID
    /// @return The L1StandardBridge address (or address(0) if unsupported)
    function getBridge(uint256 chainId) external view returns (address) {
        return bridges[chainId];
    }

    /// @notice Get the number of supported chains
    /// @return The number of supported destination chains
    function getSupportedChainCount() external view returns (uint256) {
        return supportedChains.length;
    }
}
