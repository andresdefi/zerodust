// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {ZeroDustSweep} from "../src/ZeroDustSweepMainnet.sol";

/// @title DeployMainnet
/// @notice Deploys ZeroDustSweep for mainnet with KMS sponsor using CREATE2
/// @dev Same address on all chains (deterministic deployment)
contract DeployMainnet is Script {
    /// @notice Salt for CREATE2 deployment
    bytes32 public constant DEPLOY_SALT = bytes32(uint256(0x5a65726f44757374)); // "ZeroDust" in hex

    // Fee limits
    uint256 constant MIN_OVERHEAD_GAS_UNITS = 50_000;
    uint256 constant MAX_OVERHEAD_GAS_UNITS = 300_000;
    uint256 constant MAX_PROTOCOL_FEE_GAS_UNITS = 100_000;
    uint256 constant MAX_EXTRA_FEE_WEI = 1000 ether; // Supports tokens as cheap as $0.00005 for $0.05 min fee
    uint256 constant MAX_REIMB_GAS_PRICE_CAP_WEI = 1000 gwei;

    function run() external returns (ZeroDustSweep sweep) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address sponsor = vm.envAddress("SPONSOR_ADDRESS");

        console.log("=== ZERODUST MAINNET DEPLOYMENT (CREATE2) ===");
        console.log("Deployer:", deployer);
        console.log("Sponsor (KMS):", sponsor);
        console.log("Chain ID:", block.chainid);
        console.log("Salt:", vm.toString(DEPLOY_SALT));
        console.log("");

        // Build constructor arguments
        address[] memory sponsors = new address[](1);
        sponsors[0] = sponsor;

        // Compute bytecode with constructor args
        bytes memory bytecode = abi.encodePacked(
            type(ZeroDustSweep).creationCode,
            abi.encode(
                sponsors,
                MIN_OVERHEAD_GAS_UNITS,
                MAX_OVERHEAD_GAS_UNITS,
                MAX_PROTOCOL_FEE_GAS_UNITS,
                MAX_EXTRA_FEE_WEI,
                MAX_REIMB_GAS_PRICE_CAP_WEI
            )
        );

        bytes32 bytecodeHash = keccak256(bytecode);
        address expectedAddress = computeCreate2Address(DEPLOY_SALT, bytecodeHash, CREATE2_FACTORY);

        console.log("Bytecode hash:", vm.toString(bytecodeHash));
        console.log("Expected address:", expectedAddress);

        // Check if already deployed
        if (expectedAddress.code.length > 0) {
            console.log("");
            console.log("Contract already deployed at:", expectedAddress);
            sweep = ZeroDustSweep(payable(expectedAddress));
            require(sweep.isSponsor(sponsor), "Sponsor mismatch on existing deployment!");
            return sweep;
        }

        // Validate sponsor is an EOA (no code)
        require(sponsor.code.length == 0, "Sponsor must be EOA");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy using CREATE2 factory
        bytes memory deployData = abi.encodePacked(DEPLOY_SALT, bytecode);
        (bool success,) = CREATE2_FACTORY.call(deployData);
        require(success, "CREATE2 deployment failed");

        vm.stopBroadcast();

        // Verify deployment
        require(expectedAddress.code.length > 0, "Deployment verification failed");

        sweep = ZeroDustSweep(payable(expectedAddress));
        require(sweep.isSponsor(sponsor), "Sponsor not set correctly!");

        console.log("");
        console.log("=== DEPLOYMENT SUCCESS ===");
        console.log("Chain ID:", block.chainid);
        console.log("ZeroDustSweep:", address(sweep));
        console.log("Sponsor:", sponsor);
        console.log("==========================");
    }
}

/// @title ComputeMainnetAddress
/// @notice Utility to compute the deterministic address without deploying
contract ComputeMainnetAddress is Script {
    bytes32 public constant DEPLOY_SALT = bytes32(uint256(0x5a65726f44757374));

    uint256 constant MIN_OVERHEAD_GAS_UNITS = 50_000;
    uint256 constant MAX_OVERHEAD_GAS_UNITS = 300_000;
    uint256 constant MAX_PROTOCOL_FEE_GAS_UNITS = 100_000;
    uint256 constant MAX_EXTRA_FEE_WEI = 1000 ether; // Supports tokens as cheap as $0.00005 for $0.05 min fee
    uint256 constant MAX_REIMB_GAS_PRICE_CAP_WEI = 1000 gwei;

    function run() public view {
        address sponsor = vm.envAddress("SPONSOR_ADDRESS");

        address[] memory sponsors = new address[](1);
        sponsors[0] = sponsor;

        bytes memory bytecode = abi.encodePacked(
            type(ZeroDustSweep).creationCode,
            abi.encode(
                sponsors,
                MIN_OVERHEAD_GAS_UNITS,
                MAX_OVERHEAD_GAS_UNITS,
                MAX_PROTOCOL_FEE_GAS_UNITS,
                MAX_EXTRA_FEE_WEI,
                MAX_REIMB_GAS_PRICE_CAP_WEI
            )
        );

        bytes32 bytecodeHash = keccak256(bytecode);
        address expectedAddress = computeCreate2Address(DEPLOY_SALT, bytecodeHash, CREATE2_FACTORY);

        console.log("=== ZERODUST ADDRESS PREVIEW ===");
        console.log("Sponsor:", sponsor);
        console.log("Salt:", vm.toString(DEPLOY_SALT));
        console.log("Bytecode hash:", vm.toString(bytecodeHash));
        console.log("Expected address:", expectedAddress);

        if (expectedAddress.code.length > 0) {
            console.log("Status: DEPLOYED");
        } else {
            console.log("Status: NOT YET DEPLOYED");
        }
        console.log("================================");
    }
}
