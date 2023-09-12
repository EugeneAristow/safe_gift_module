// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.7.0 <0.9.0;

// Required for triggering execution
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

contract ExampleModule {
    function tokenTransfer(GnosisSafe safe, address token, address to, uint amount) public {
        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", to, amount);
        require(safe.execTransactionFromModule(token, 0, data, Enum.Operation.Call), "Could not execute token transfer");
    }
}