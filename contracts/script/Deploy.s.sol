// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MatchRegistry} from "../src/MatchRegistry.sol";

/// @notice Deploys `MatchRegistry` to Monad Testnet (chainId 10143).
///
/// Usage:
///   MONAD_RPC_URL=https://testnet-rpc.monad.xyz \
///   PRIVATE_KEY=0x... \
///   forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_RPC_URL" --broadcast
///
/// The signer comes from the environment or `--account`, never from a committed
/// file. The deploying address becomes the contract owner, so it must be the
/// same address the game server holds as `SERVER_SIGNER_PRIVATE_KEY`.
contract Deploy is Script {
    function run() external returns (MatchRegistry registry) {
        require(block.chainid == 10143, "Deploy: wrong chain, expected Monad Testnet 10143");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        registry = new MatchRegistry();
        vm.stopBroadcast();

        console.log("MatchRegistry deployed at:", address(registry));
        console.log("Owner (must match the server signer):", registry.owner());
        console.log("Chain id:", block.chainid);
    }
}
