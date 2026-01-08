// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IZeroDustAdapter} from "../interfaces/IZeroDustAdapter.sol";

/**
 * @title OPStackAdapter
 * @author ZeroDust
 * @notice Bridge adapter for OP Stack native bridges (L1StandardBridge)
 * @dev Used for testnet cross-chain testing (Sepolia → Base Sepolia, etc.)
 *
 * OP Stack bridges use different L1StandardBridge addresses per destination chain.
 * This adapter stores the bridge address and destination chain ID as immutables.
 *
 * Key differences from production bridges (Bungee):
 * - One adapter instance per destination chain
 * - No slippage (native bridge, 1:1 transfer)
 * - Bridge time ~2-10 minutes for L1→L2
 */
contract OPStackAdapter is IZeroDustAdapter {
    /// @notice The L1StandardBridge contract address
    address public immutable l1StandardBridge;

    /// @notice The destination chain ID this adapter bridges to
    uint256 public immutable destinationChain;

    /// @notice Minimum gas limit for L2 execution (100k is sufficient for ETH transfers)
    uint32 public constant MIN_GAS_LIMIT = 100000;

    /// @notice Error when destination chain doesn't match
    error InvalidDestinationChain(uint256 requested, uint256 supported);

    /// @notice Error when bridge call fails
    error BridgeFailed();

    /**
     * @notice Construct the adapter with bridge address and destination chain
     * @param _l1StandardBridge L1StandardBridge address on this L1
     * @param _destinationChain Chain ID of the L2 this bridge connects to
     */
    constructor(address _l1StandardBridge, uint256 _destinationChain) {
        require(_l1StandardBridge != address(0), "Invalid bridge address");
        require(_destinationChain != 0, "Invalid destination chain");
        l1StandardBridge = _l1StandardBridge;
        destinationChain = _destinationChain;
    }

    /**
     * @inheritdoc IZeroDustAdapter
     * @dev Calls L1StandardBridge.depositETHTo() to bridge ETH to L2
     *
     * Note: OP Stack native bridges have no slippage - user receives exactly what is sent
     * (minus any L2 gas costs which are negligible for ETH). Therefore minReceive is
     * effectively ignored but validated for interface compliance.
     *
     * The refundRecipient parameter is also not used by OP Stack bridges since there
     * are no refunds - the bridge is guaranteed to deliver. In rare failure cases,
     * funds can be recovered through the bridge's manual withdrawal process.
     */
    function executeNativeBridge(
        uint256 _destinationChainId,
        address _destination,
        uint256 _minReceive,
        address _refundRecipient,
        bytes calldata _adapterData
    ) external payable override {
        // Validate destination chain matches this adapter
        if (_destinationChainId != destinationChain) {
            revert InvalidDestinationChain(_destinationChainId, destinationChain);
        }

        // Silence unused variable warnings (OP Stack doesn't use these)
        (_minReceive, _refundRecipient, _adapterData);

        // Call L1StandardBridge.depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData)
        // Note: Function selector 0x9a2ac6d5
        (bool success, ) = l1StandardBridge.call{value: msg.value}(
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
        return "OP Stack Native Bridge";
    }

    /// @inheritdoc IZeroDustAdapter
    function supportedChainIds() external view override returns (uint256[] memory) {
        uint256[] memory chains = new uint256[](1);
        chains[0] = destinationChain;
        return chains;
    }

    /// @inheritdoc IZeroDustAdapter
    function supportsChain(uint256 chainId) external view override returns (bool) {
        return chainId == destinationChain;
    }
}
