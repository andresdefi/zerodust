// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import { ZeroDustPermissionRouter } from "../src/ZeroDustPermissionRouter.sol";

/**
 * Deploys ZeroDustPermissionRouter through the CREATE2 factory, at the same address on every chain
 * (MetaMask's DelegationManager is at one address everywhere, so the bytecode is identical).
 * Same sponsor and bounds as ZeroDustSweep (DeployMainnet.s.sol).
 *
 *   Preview: SPONSOR_ADDRESS=0x... forge script script/DeployPermissionRouter.s.sol:ComputePermissionRouterAddress --rpc-url <rpc>
 *   Deploy:  PRIVATE_KEY=... SPONSOR_ADDRESS=0x... forge script script/DeployPermissionRouter.s.sol:DeployPermissionRouter --rpc-url <rpc> --broadcast
 */
library PermissionRouterDeployment {
    bytes32 internal constant SALT = keccak256("ZeroDust permission router v1");

    uint256 internal constant MIN_OVERHEAD_GAS_UNITS = 50_000;
    uint256 internal constant MAX_OVERHEAD_GAS_UNITS = 300_000;
    uint256 internal constant MAX_PROTOCOL_FEE_GAS_UNITS = 100_000;
    uint256 internal constant MAX_EXTRA_FEE_WEI = 1000 ether;
    uint256 internal constant MAX_REIMB_GAS_PRICE_CAP_WEI = 1000 gwei;

    function initCode(address sponsor) internal pure returns (bytes memory) {
        address[] memory sponsors = new address[](1);
        sponsors[0] = sponsor;
        return abi.encodePacked(
            type(ZeroDustPermissionRouter).creationCode,
            abi.encode(
                sponsors,
                MIN_OVERHEAD_GAS_UNITS,
                MAX_OVERHEAD_GAS_UNITS,
                MAX_PROTOCOL_FEE_GAS_UNITS,
                MAX_EXTRA_FEE_WEI,
                MAX_REIMB_GAS_PRICE_CAP_WEI
            )
        );
    }
}

contract DeployPermissionRouter is Script {
    function run() external returns (ZeroDustPermissionRouter router) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address sponsor = vm.envAddress("SPONSOR_ADDRESS");
        bytes memory initCode = PermissionRouterDeployment.initCode(sponsor);
        address expected = computeCreate2Address(PermissionRouterDeployment.SALT, keccak256(initCode), CREATE2_FACTORY);
        console.log("Chain ID:", block.chainid);
        console.log("Expected address:", expected);

        if (expected.code.length == 0) {
            require(sponsor.code.length == 0, "Sponsor must be EOA");
            vm.startBroadcast(deployerPrivateKey);
            (bool success,) = CREATE2_FACTORY.call(abi.encodePacked(PermissionRouterDeployment.SALT, initCode));
            require(success, "CREATE2 deployment failed");
            vm.stopBroadcast();
            require(expected.code.length > 0, "Deployment verification failed");
        } else {
            console.log("Already deployed");
        }

        router = ZeroDustPermissionRouter(payable(expected));
        require(router.SPONSOR_1() == sponsor, "Sponsor mismatch");
        require(router.DELEGATION_MANAGER().code.length > 0, "No MetaMask DelegationManager on this chain");
    }
}

contract ComputePermissionRouterAddress is Script {
    function run() public view {
        address sponsor = vm.envAddress("SPONSOR_ADDRESS");
        bytes memory initCode = PermissionRouterDeployment.initCode(sponsor);
        address expected = computeCreate2Address(PermissionRouterDeployment.SALT, keccak256(initCode), CREATE2_FACTORY);
        console.log("Sponsor:", sponsor);
        console.log("Init code hash:", vm.toString(keccak256(initCode)));
        console.log("Expected address:", expected);
        console.log(expected.code.length > 0 ? "Status: DEPLOYED" : "Status: NOT YET DEPLOYED");
    }
}
