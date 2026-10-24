// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TestnetPoolEscrow} from "../src/TestnetPoolEscrow.sol";

/// @notice Deploys `TestnetPoolEscrow` to Monad Testnet (chainId 10143).
///
/// Usage:
///   MONAD_RPC_URL=https://testnet-rpc.monad.xyz \
///   PRIVATE_KEY=0x... ADMIN_ADDRESS=0x... SETTLER_ADDRESS=0x... \
///   forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_RPC_URL" --broadcast
///
/// Two signers are required on purpose. The deploy key becomes
/// DEFAULT_ADMIN_ROLE and should stay cold; the server's hot key gets only
/// SETTLER_ROLE. Collapsing them into one key means a leaked server key can also
/// grant roles and cancel funded rooms — see ESCROW_SECURITY §"Key handling".
contract Deploy is Script {
    // Product defaults from DECISIONS.md. Overridable by env for a rehearsal deploy.
    uint256 internal constant DEFAULT_MIN_WEI = 0.001 ether;
    uint256 internal constant DEFAULT_MAX_WEI = 0.01 ether;
    uint64 internal constant DEFAULT_FUNDING_WINDOW_SEC = 600;
    uint64 internal constant DEFAULT_RESOLUTION_WINDOW_SEC = 1200;

    function run() external returns (TestnetPoolEscrow escrow) {
        require(block.chainid == 10143, "Deploy: wrong chain, expected Monad Testnet 10143");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("ADMIN_ADDRESS", vm.addr(deployerKey));
        address settler = vm.envAddress("SETTLER_ADDRESS");

        require(settler != address(0), "Deploy: SETTLER_ADDRESS required");
        require(settler != admin, "Deploy: settler must differ from admin");

        vm.startBroadcast(deployerKey);
        escrow = new TestnetPoolEscrow(
            admin,
            settler,
            vm.envOr("ENTRY_MIN_WEI", DEFAULT_MIN_WEI),
            vm.envOr("ENTRY_MAX_WEI", DEFAULT_MAX_WEI),
            uint64(vm.envOr("FUNDING_WINDOW_SEC", uint256(DEFAULT_FUNDING_WINDOW_SEC))),
            uint64(vm.envOr("RESOLUTION_WINDOW_SEC", uint256(DEFAULT_RESOLUTION_WINDOW_SEC)))
        );
        vm.stopBroadcast();

        console.log("TestnetPoolEscrow:", address(escrow));
        console.log("admin (DEFAULT_ADMIN_ROLE):", admin);
        console.log("settler (SETTLER_ROLE):   ", settler);
        console.log("chain id:", block.chainid);
        console.log("deployment block:", block.number);
        console.log("Record the block number as ESCROW_DEPLOYMENT_BLOCK.");
    }
}
