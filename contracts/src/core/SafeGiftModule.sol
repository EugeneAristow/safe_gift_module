// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.7.0 <0.9.0;

/// @dev Original Gnosis contract deps are left for strictness,
///      simplicity and due to the lack of Interfaces.
///      Interfaces are preferable in producrion case.
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

/// @dev GnosisSafe module which supports the token hand-out mechanism.
/// @dev Relates to specific GnosisSafe instance and specific token.
contract SafeGiftModule {
    /// @dev Used to check signatures validity.
    ///      NOTE: actually a nonce value is not important in our 'gift' case
    ///      from GnosisSafe perspective hence some specific value is hardcoded.
    uint private constant GIFT_NONCE = 42;

    /// @dev Extra message hash for additional securiry.
    bytes32 public immutable GIFT_DEAL_MSG_HASH;

    /// @dev The token for hand-out.
    address private immutable tokenToGift;
    /// @dev Specific to this module GnosisSafe instance.
    ///      NOTE: Actually it's a GnosisSafeProxy wrapper
    ///      which proxies to the abi-compatible calls to singleton GnosisSafe.
    GnosisSafe private immutable safeInstance;

    /// @dev Due date of token hand-out deal availability.
    uint64 public expiry;
    /// @dev Track addresses which have already received the tokens.
    mapping (address => bool) public alreadyGifted;

    /// @dev Also calculates special message hash based on argumets.
    constructor (address token, GnosisSafe target) {
        tokenToGift = token;
        safeInstance = target;

        // Compute the gift deal message hash.
        GIFT_DEAL_MSG_HASH = keccak256(
            abi.encodePacked(
                keccak256(
                    "This is the arbitrary amount token hand-out from us"
                    "for everyone. Don't abuse this gift and use only once."
                ),
                token,
                target
            )
        );
    }

    /// @dev onlyOwner implementation via usage of related Safe
    modifier onlyOwner() {
        require(safeInstance.isOwner(msg.sender), "SafeGiftModule: onlyOwner");
        _;
    }

    /// @dev Checks whether this module is enabled by related GnosisSafe
    modifier onlyEnabled() {
        require(safeInstance.isModuleEnabled(address(this)), "SafeGiftModule: module isn't enabled");
        _;
    }

    /// @dev Transfers the gift deal tokens to taker if owner signatures are valid.
    /// @param signatures Signatures of related GnosisSafe owners.
    /// @param taker The recipient of tokens.
    /// @param amount The hand-out tokens amount.
    function takeTheGift(
        bytes memory signatures,
        address taker,
        uint amount
    ) external onlyEnabled() {
        // Check who's claiming to prevent the abuse.
        // If some account has already taken part in the deal then also revert.
        require(!(alreadyGifted[msg.sender] && alreadyGifted[taker]),
            "SafeGiftModule: You have already received the gift");
        // Check for expiry.
        require(block.timestamp < expiry,
            "SafeGiftModule: The gift deal is expired");

        // Check signatures validity.
        // Encode the gift deal message data.
        bytes memory giftDealData = abi.encodePacked(GIFT_DEAL_MSG_HASH, amount);

        // Calculate message data which should be signed by owners.
        bytes memory txHashData =
            safeInstance.encodeTransactionData(
                // Transaction info
                tokenToGift,
                0,
                giftDealData,
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

        // CHECK-EFFECTS-INTERACTION pattern.
        alreadyGifted[msg.sender] = true;
        alreadyGifted[taker] = true;
        // Perform target action and revert if failed.
        bytes memory transferCalldata = abi.encodeWithSignature("transfer(address,uint256)", taker, amount);
        require(safeInstance.execTransactionFromModule(tokenToGift, 0, transferCalldata, Enum.Operation.Call),
            "SafeGiftModule: Could not execute token transfer");
    }

    /// @dev Sets expiry of the gift deal.
    /// @param newExpiry Timestamp since Unix epoch.
    function setExpiry(uint64 newExpiry) external onlyOwner {
        expiry = newExpiry;
    }
}