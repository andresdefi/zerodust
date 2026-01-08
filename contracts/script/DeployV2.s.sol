// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {ZeroDustSweepV2} from "../src/ZeroDustSweepV2.sol";
import {MockAdapter} from "../src/adapters/MockAdapter.sol";

/// @title DeployV2
/// @notice Deploys ZeroDustSweepV2 with MockAdapter for testing
/// @dev For testnet deployment only. Mainnet would use real adapters.
contract DeployV2 is Script {
    function run() external returns (ZeroDustSweepV2 sweepV2, MockAdapter mockAdapter) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MockAdapter with deployer as treasury
        mockAdapter = new MockAdapter(deployer);
        console.log("MockAdapter deployed at:", address(mockAdapter));
        console.log("MockAdapter treasury:", mockAdapter.treasury());

        // 2. Deploy ZeroDustSweepV2 with MockAdapter in allowlist
        address[] memory adapters = new address[](1);
        adapters[0] = address(mockAdapter);

        sweepV2 = new ZeroDustSweepV2(adapters);
        console.log("ZeroDustSweepV2 deployed at:", address(sweepV2));
        console.log("Domain Separator:", vm.toString(sweepV2.DOMAIN_SEPARATOR()));

        // 3. Verify adapter is in allowlist
        address[] memory allowedAdapters = sweepV2.getAllowedAdapters();
        console.log("Allowed adapters count:", allowedAdapters.length);
        console.log("Adapter 0:", allowedAdapters[0]);

        require(allowedAdapters[0] == address(mockAdapter), "MockAdapter not in allowlist!");

        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYMENT SUMMARY ===");
        console.log("Chain ID:", block.chainid);
        console.log("MockAdapter:", address(mockAdapter));
        console.log("ZeroDustSweepV2:", address(sweepV2));
        console.log("==========================");
    }
}
