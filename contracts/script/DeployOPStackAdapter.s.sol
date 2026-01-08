// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {ZeroDustSweepV2} from "../src/ZeroDustSweepV2.sol";
import {OPStackAdapter} from "../src/adapters/OPStackAdapter.sol";
import {MockAdapter} from "../src/adapters/MockAdapter.sol";

/// @title DeployOPStackAdapter
/// @notice Deploys OPStackAdapter for Sepolia → Base Sepolia bridging
/// @dev Also deploys a new ZeroDustSweepV2 with OPStackAdapter in the allowlist
contract DeployOPStackAdapter is Script {
    // L1StandardBridge for Base Sepolia on Ethereum Sepolia
    // Official address from Base docs: https://docs.base.org/base-chain/network-information/base-contracts
    address constant BASE_SEPOLIA_L1_BRIDGE = 0xfd0Bf71F60660E2f608ed56e1659C450eB113120;

    // Base Sepolia chain ID
    uint256 constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external returns (
        OPStackAdapter opStackAdapter,
        MockAdapter mockAdapter,
        ZeroDustSweepV2 sweepV2
    ) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== DEPLOYMENT CONFIG ===");
        console.log("Deployer:", deployer);
        console.log("Source Chain ID:", block.chainid);
        console.log("Destination Chain ID:", BASE_SEPOLIA_CHAIN_ID);
        console.log("L1StandardBridge:", BASE_SEPOLIA_L1_BRIDGE);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy OPStackAdapter for Base Sepolia
        opStackAdapter = new OPStackAdapter(BASE_SEPOLIA_L1_BRIDGE, BASE_SEPOLIA_CHAIN_ID);
        console.log("OPStackAdapter deployed at:", address(opStackAdapter));
        console.log("  - Bridge name:", opStackAdapter.bridgeName());
        console.log("  - Supports Base Sepolia:", opStackAdapter.supportsChain(BASE_SEPOLIA_CHAIN_ID));

        // 2. Deploy MockAdapter for same-chain testing (deployer as treasury)
        mockAdapter = new MockAdapter(deployer);
        console.log("MockAdapter deployed at:", address(mockAdapter));

        // 3. Deploy ZeroDustSweepV2 with BOTH adapters in allowlist
        address[] memory adapters = new address[](2);
        adapters[0] = address(opStackAdapter);  // Real bridge adapter
        adapters[1] = address(mockAdapter);      // Mock for same-chain tests

        sweepV2 = new ZeroDustSweepV2(adapters);
        console.log("ZeroDustSweepV2 deployed at:", address(sweepV2));

        // 4. Verify adapters are in allowlist
        address[] memory allowedAdapters = sweepV2.getAllowedAdapters();
        console.log("");
        console.log("Allowed adapters count:", allowedAdapters.length);
        require(allowedAdapters.length == 2, "Expected 2 adapters!");
        require(sweepV2.isAllowedAdapter(address(opStackAdapter)), "OPStackAdapter not allowed!");
        require(sweepV2.isAllowedAdapter(address(mockAdapter)), "MockAdapter not allowed!");

        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYMENT SUMMARY ===");
        console.log("Chain ID (source):", block.chainid);
        console.log("OPStackAdapter:", address(opStackAdapter));
        console.log("  -> bridges to Base Sepolia (84532)");
        console.log("MockAdapter:", address(mockAdapter));
        console.log("  -> for same-chain testing");
        console.log("ZeroDustSweepV2:", address(sweepV2));
        console.log("");
        console.log("To test real cross-chain sweep:");
        console.log("  export SWEEP_V2_CONTRACT=", address(sweepV2));
        console.log("  export OP_STACK_ADAPTER=", address(opStackAdapter));
        console.log("  export DEST_CHAIN_ID=84532");
        console.log("==========================");
    }
}
