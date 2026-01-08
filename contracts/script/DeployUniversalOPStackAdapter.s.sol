// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {UniversalOPStackAdapter} from "../src/adapters/UniversalOPStackAdapter.sol";
import {ZeroDustSweepV2} from "../src/ZeroDustSweepV2.sol";

/**
 * @title DeployUniversalOPStackAdapter
 * @notice Deploys UniversalOPStackAdapter with 15 OP Stack L2 bridges and new V2
 * @dev Run with: forge script script/DeployUniversalOPStackAdapter.s.sol:DeployUniversalOPStackAdapter --rpc-url $RPC_URL --broadcast -vvvv
 *
 * Supported destinations (Sepolia → L2):
 * 1. Base Sepolia (84532)
 * 2. OP Sepolia (11155420)
 * 3. Mode Sepolia (919)
 * 4. Zora Sepolia (999999999)
 * 5. Unichain Sepolia (1301)
 * 6. Ink Sepolia (763373)
 * 7. Shape Sepolia (11011)
 * 8. Lisk Sepolia (4202)
 * 9. World Chain Sepolia (4801)
 * 10. Metal L2 Testnet (1740)
 * 11. Soneium Minato (1946)
 * 12. Ancient8 Testnet (28122024)
 * 13. Superseed Sepolia (53302)
 * 14. BOB Sepolia (808813)
 * 15. Celo Sepolia (11142220)
 */
contract DeployUniversalOPStackAdapter is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Build arrays of chain IDs and their corresponding L1StandardBridge addresses on Sepolia
        uint256[] memory chainIds = new uint256[](15);
        address[] memory bridges = new address[](15);

        // 1. Base Sepolia
        chainIds[0] = 84532;
        bridges[0] = 0xfd0Bf71F60660E2f608ed56e1659C450eB113120;

        // 2. OP Sepolia
        chainIds[1] = 11155420;
        bridges[1] = 0xFBb0621E0B23b5478B630BD55a5f21f67730B0F1;

        // 3. Mode Sepolia
        chainIds[2] = 919;
        bridges[2] = 0xbC5C679879B2965296756CD959C3C739769995E2;

        // 4. Zora Sepolia
        chainIds[3] = 999999999;
        bridges[3] = 0x5376f1D543dcbB5BD416c56C189e4cB7399fCcCB;

        // 5. Unichain Sepolia
        chainIds[4] = 1301;
        bridges[4] = 0xea58fcA6849d79EAd1f26608855c2D6407d54Ce2;

        // 6. Ink Sepolia
        chainIds[5] = 763373;
        bridges[5] = 0x33f60714BbD74d62b66D79213C348614DE51901C;

        // 7. Shape Sepolia
        chainIds[6] = 11011;
        bridges[6] = 0x341ab1DAFdfB73b3D6D075ef10b29e3cACB2A653;

        // 8. Lisk Sepolia
        chainIds[7] = 4202;
        bridges[7] = 0x1Fb30e446eA791cd1f011675E5F3f5311b70faF5;

        // 9. World Chain Sepolia
        chainIds[8] = 4801;
        bridges[8] = 0xd7DF54b3989855eb66497301a4aAEc33Dbb3F8DE;

        // 10. Metal L2 Testnet
        chainIds[9] = 1740;
        bridges[9] = 0x21530aAdF4DCFb9c477171400E40d4ef615868BE;

        // 11. Soneium Minato
        chainIds[10] = 1946;
        bridges[10] = 0x5f5a404A5edabcDD80DB05E8e54A78c9EBF000C2;

        // 12. Ancient8 Testnet
        chainIds[11] = 28122024;
        bridges[11] = 0xF6Bc0146d3c74D48306e79Ae134A260E418C9335;

        // 13. Superseed Sepolia
        chainIds[12] = 53302;
        bridges[12] = 0x2B227A603fAAdB3De0ED050b63ADD232B5f2c28C;

        // 14. BOB Sepolia
        chainIds[13] = 808813;
        bridges[13] = 0x75f48FE4DeAB3F9043EE995c3C84D6a2303D9a2F;

        // 15. Celo Sepolia
        chainIds[14] = 11142220;
        bridges[14] = 0xEc18a3c30131A0Db4246e785355fBc16E2eAF408;

        vm.startBroadcast(deployerPrivateKey);

        // Deploy UniversalOPStackAdapter
        UniversalOPStackAdapter adapter = new UniversalOPStackAdapter(chainIds, bridges);
        console.log("UniversalOPStackAdapter deployed at:", address(adapter));
        console.log("Supported chains:", adapter.getSupportedChainCount());

        // Create adapter array for V2
        address[] memory adapters = new address[](1);
        adapters[0] = address(adapter);

        // Deploy new ZeroDustSweepV2 with the universal adapter
        ZeroDustSweepV2 sweepV2 = new ZeroDustSweepV2(adapters);
        console.log("ZeroDustSweepV2 deployed at:", address(sweepV2));

        // Verify adapter is allowed
        console.log("Adapter allowed:", sweepV2.isAllowedAdapter(address(adapter)));

        vm.stopBroadcast();

        // Print summary
        console.log("\n=== Deployment Summary ===");
        console.log("UniversalOPStackAdapter:", address(adapter));
        console.log("ZeroDustSweepV2:", address(sweepV2));
        console.log("\nSupported destinations:");
        console.log("  1. Base Sepolia (84532)");
        console.log("  2. OP Sepolia (11155420)");
        console.log("  3. Mode Sepolia (919)");
        console.log("  4. Zora Sepolia (999999999)");
        console.log("  5. Unichain Sepolia (1301)");
        console.log("  6. Ink Sepolia (763373)");
        console.log("  7. Shape Sepolia (11011)");
        console.log("  8. Lisk Sepolia (4202)");
        console.log("  9. World Chain Sepolia (4801)");
        console.log("  10. Metal L2 Testnet (1740)");
        console.log("  11. Soneium Minato (1946)");
        console.log("  12. Ancient8 Testnet (28122024)");
        console.log("  13. Superseed Sepolia (53302)");
        console.log("  14. BOB Sepolia (808813)");
        console.log("  15. Celo Sepolia (11142220)");
    }
}
