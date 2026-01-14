// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {ZeroDustSweepV3TEST2} from "../src/ZeroDustSweepV3TEST.sol";

/// @title DeployV3
/// @notice Deploys ZeroDustSweepV3TEST2 for testnet
/// @dev Sponsor is the deployer. For mainnet, use KMS-protected keys.
contract DeployV3 is Script {
    // Fee limits matching backend V3_FEE_LIMITS in signature.ts
    uint256 constant MIN_OVERHEAD_GAS_UNITS = 50_000;
    uint256 constant MAX_OVERHEAD_GAS_UNITS = 300_000;
    uint256 constant MAX_PROTOCOL_FEE_GAS_UNITS = 100_000;
    uint256 constant MAX_EXTRA_FEE_WEI = 0.0005 ether; // 500_000_000_000_000 wei
    uint256 constant MAX_REIMB_GAS_PRICE_CAP_WEI = 1000 gwei; // 1_000_000_000_000 wei

    function run() external returns (ZeroDustSweepV3TEST2 sweepV3) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // Sponsor list: just the deployer for testnet
        address[] memory sponsors = new address[](1);
        sponsors[0] = deployer;

        // Deploy V3 contract
        sweepV3 = new ZeroDustSweepV3TEST2(
            sponsors,
            MIN_OVERHEAD_GAS_UNITS,
            MAX_OVERHEAD_GAS_UNITS,
            MAX_PROTOCOL_FEE_GAS_UNITS,
            MAX_EXTRA_FEE_WEI,
            MAX_REIMB_GAS_PRICE_CAP_WEI
        );

        console.log("ZeroDustSweepV3TEST2 deployed at:", address(sweepV3));

        // Verify sponsor is set
        require(sweepV3.isSponsor(deployer), "Deployer not set as sponsor!");

        vm.stopBroadcast();

        console.log("");
        console.log("=== V3 DEPLOYMENT SUMMARY ===");
        console.log("Chain ID:", block.chainid);
        console.log("ZeroDustSweepV3TEST2:", address(sweepV3));
        console.log("Sponsor:", deployer);
        console.log("MIN_OVERHEAD_GAS_UNITS:", MIN_OVERHEAD_GAS_UNITS);
        console.log("MAX_OVERHEAD_GAS_UNITS:", MAX_OVERHEAD_GAS_UNITS);
        console.log("MAX_PROTOCOL_FEE_GAS_UNITS:", MAX_PROTOCOL_FEE_GAS_UNITS);
        console.log("MAX_EXTRA_FEE_WEI:", MAX_EXTRA_FEE_WEI);
        console.log("MAX_REIMB_GAS_PRICE_CAP_WEI:", MAX_REIMB_GAS_PRICE_CAP_WEI);
        console.log("==============================");
    }
}
