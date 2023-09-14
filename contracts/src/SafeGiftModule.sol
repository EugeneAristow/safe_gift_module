// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.7.0 <0.9.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

contract SafeGiftModule {
    /// @dev Some 'reserved' nonce value for 'gift' scenario
    /// @dev used to check signature validity.
    /// @dev NOTE: actually a nonce value is not important in our 'gift'
    /// @dev scenario hence some specific value is hardcoded.
    uint private constant GIFT_NONCE = 42;
    /// @dev Since everyone should be able to receive the gift predefine.
    /// @dev Some 'receiver' address.
    address private constant PREDEFINED_GIFT_ADDRESS = 0x0000000000000000000000000000000000000000;

    /// @dev Due date of token hand-out availability.
    uint64 public expiry;
    /// @dev Track addresses which have already received the tokens.
    mapping (address => bool) public alreadyGifted;
    /// @dev The token for hand-out.
    address private immutable tokenToGift;
    /// @dev Specific to this module GnosisSafe instance.
    /// @dev NOTE: Actually it's a GnosisSafeProxy wrapper
    /// @dev which proxies to the abi-compatible calls to singleton GnosisSafe.
    GnosisSafe private immutable safeInstance;

    constructor (address token, GnosisSafe target) {
        tokenToGift = token;
        safeInstance = target;
    }

    modifier onlyOwner() {
        require(safeInstance.isOwner(msg.sender), "SafeGiftModule: onlyOwner");
        _;
    }

    modifier onlyEnabled() {
        require(safeInstance.isModuleEnabled(address(this)), "SafeGiftModule: module isn't enabled");
        _;
    }

    function takeTheGift(
        bytes memory signatures,
        address taker,
        uint amount
    ) external onlyEnabled() {
        // Check who's claiming to prevent the abuse.
        require(!(alreadyGifted[msg.sender] && alreadyGifted[taker]),
            "SafeGiftModule: You have already received the gift");
        // Check for expiry.
        require(block.timestamp < expiry,
            "SafeGiftModule: The gift deal is expired");

        // Encode calldata for tokens transfer.
        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", PREDEFINED_GIFT_ADDRESS, amount);

        // Check signatures validity.
        {
            // Calculate message data which should be signed by owners.
            bytes memory txHashData =
                safeInstance.encodeTransactionData(
                    // Transaction info
                    tokenToGift,
                    0,
                    data,
                    Enum.Operation.Call,
                    0,
                    // Payment info
                    0,
                    0,
                    address(0),
                    address(0),
                    // Signature info
                    GIFT_NONCE
                );
            // Calculate tx hash to check validity of passed signatures.
            bytes32 txHash = keccak256(txHashData);
            // The call result isn't handled to pass original GnosisSafe
            // revert msg/code if any.
            safeInstance.checkSignatures(txHash, txHashData, signatures);
        }

        // CHECK-EFFECTS-INTERACTION pattern.
        alreadyGifted[msg.sender] = true;
        alreadyGifted[taker] = true;
        // Perform target action and revert if failed.
        bytes memory transferCalldata = abi.encodeWithSignature("transfer(address,uint256)", taker, amount);
        require(safeInstance.execTransactionFromModule(tokenToGift, 0, transferCalldata, Enum.Operation.Call),
            "SafeGiftModule: Could not execute token transfer");
    }

    function setExpiry(uint64 newExpiry) external onlyOwner {
        expiry = newExpiry;
    }
}