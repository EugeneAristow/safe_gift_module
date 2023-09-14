import { network, config, ethers } from "hardhat";
import { expect } from "chai";

const BLOCK_NUMBER = 18127149;
const ADDRESS_0 = "0x0000000000000000000000000000000000000000";

const forkSpecificState = async (blockNumber = BLOCK_NUMBER) => {
  await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
            forking: {
                jsonRpcUrl: process.env.ETH_URL,
                blockNumber,
            },
        },
      ],
  });
};

async function generateSignatures(
    gnosisSafeProxy: ethers.Contract,
    owner1Wallet: ethers.Wallet,
    owner2Wallet: ethers.Wallet,
    calldata: string,
    toAddress: string,
    nonce: ethers.BigNumber | undefined,
): Promise<string> {
    if (nonce === undefined) nonce = ethers.BigNumber.from(await gnosisSafeProxy.nonce());

    // Get on-chain Safe transaction Data
    const safeTxData = await gnosisSafeProxy.encodeTransactionData(
        toAddress, // address to,
        0, // uint256 value,
        calldata, // bytes calldata data,
        0, // Enum.Operation operation,
        0, // uint256 safeTxGas,
        0, // uint256 baseGas,
        0, // uint256 gasPrice,
        ADDRESS_0, // address gasToken,
        ADDRESS_0, // address refundReceiver,
        nonce // uint256 _nonce
    );
    // Get on-chain Safe transaction hash to be signed
    const safeTxHash = await gnosisSafeProxy.getTransactionHash(
        toAddress, // address to,
        0, // uint256 value,
        calldata, // bytes calldata data,
        0, // Enum.Operation operation,
        0, // uint256 safeTxGas,
        0, // uint256 baseGas,
        0, // uint256 gasPrice,
        ADDRESS_0, // address gasToken,
        ADDRESS_0, // address refundReceiver,
        nonce // uint256 _nonce
    );

    // Generate signatures from safeTxHash
    const signature1 = owner1Wallet._signingKey().signDigest(safeTxHash);
    const aggregatedSignature1 = signature1.r + signature1.s.substr(2) + ethers.utils.hexlify(signature1.v).substr(2);
    const signature2 = owner2Wallet._signingKey().signDigest(safeTxHash);
    const aggregatedSignature2 = signature2.r + signature2.s.substr(2) + ethers.utils.hexlify(signature2.v).substr(2);

    // NOTE: strictly-ordered
    let aggregatedSignatures :string;
    if (ethers.BigNumber.from(owner1Wallet.address).gt(ethers.BigNumber.from(owner2Wallet.address)))
        aggregatedSignatures = aggregatedSignature2 + aggregatedSignature1.substr(2);
    else
        aggregatedSignatures = aggregatedSignature1 + aggregatedSignature2.substr(2);

    // Check the validity
    await gnosisSafeProxy.checkSignatures(
        safeTxHash, // bytes32 dataHash,
        safeTxData, // bytes memory data,
        aggregatedSignatures // bytes memory signatures
    );
    return aggregatedSignatures;
}

describe ("SafeGiftModule x GnosisSafe integration tests", () => {
    let deployer, owner1, owner2, taker, another_taker: ethers.Signer;
    let owner1Wallet, owner2Wallet: ethers.Wallet;

    let safeGiftModule: ethers.Contract;
    let gnosisSafeProxyFactory: ethers.Contract;
    let gnosisSafeProxy: ethers.Contract;
    let gnosisSafe: ethers.Contract; // Singleton

    let giftToken: ethers.Contract;

    before(async function () {
        // Deploy GnosisSafeProxyFactory, GnosisSafeProxy, GnosisSafe singleton,
        // TestToken contract and enable SafeGiftModule as a GnosisSafeProxy module

        // Fork mainnet state
        await forkSpecificState();
        // Access some deafult signers
        [deployer, owner1, owner2, taker, another_taker] = await ethers.getSigners();
        // Get 'owner1', 'owner2' PKs for further signature generating
        const accounts = config.networks.hardhat.accounts;
        owner1Wallet = ethers.Wallet.fromMnemonic(accounts.mnemonic, accounts.path + `/${1}`);
        owner2Wallet = ethers.Wallet.fromMnemonic(accounts.mnemonic, accounts.path + `/${2}`);

        // Deploy TestToken contract
        const testTokenCF = await ethers.getContractFactory("TestToken");
        giftToken = await testTokenCF.connect(deployer).deploy();

        // Deploy GnosisSafeProxyFactory contract
        const gnosisSafeProxyFactoryCF = await ethers.getContractFactory("GnosisSafeProxyFactory");
        gnosisSafeProxyFactory = await gnosisSafeProxyFactoryCF.connect(deployer).deploy();

        // Create GnosisSafe (acts as a singleton)
        const gnosisSafeCF = await ethers.getContractFactory("GnosisSafe");
        gnosisSafe = await gnosisSafeCF.connect(deployer).deploy();

        // Encode calldata for basic gnosisSafeProxy storage setup
        const setupCalldata = gnosisSafe.interface.encodeFunctionData(
            "setup",
            [
                [owner1.address, owner2.address], // address[] calldata _owners
                2, // uint256 _threshold
                ADDRESS_0, // address to
                "0x", // bytes calldata data
                ADDRESS_0, // address fallbackHandler
                ADDRESS_0, // address paymentToken
                0, // uint256 payment,
                ADDRESS_0 // address payable paymentReceiver
            ]
        );
        const tx = await gnosisSafeProxyFactory.createProxy(gnosisSafe.address, setupCalldata);
        const txReceipt = await tx.wait(1);

        // Need to parse log for GnosisSafeProxy address
        let eventLog = txReceipt.logs[1];
        let log = gnosisSafeProxyFactory.interface.parseLog(eventLog);
        // The expectation is a GnosisSafeProxyFactory::ProxyCreation event
        // Wrap parsed GnosisSafeProxy address into GnosisSafe interface
        gnosisSafeProxy = (await ethers.getContractFactory("GnosisSafe")).attach(log.args.proxy);

        // Deploy SafeGiftModule instance
        const safeGiftModuleCF = await ethers.getContractFactory("SafeGiftModule");
        safeGiftModule = await safeGiftModuleCF.connect(deployer).deploy(giftToken.address, gnosisSafeProxy.address);

        // Send all minted tokens to GnosisSafeProxy
        await giftToken.connect(deployer).transfer(
            gnosisSafeProxy.address, await giftToken.connect(deployer).balanceOf(deployer.address));
        // Control expected side-effect
        const proxyBalance = await giftToken.balanceOf(gnosisSafeProxy.address);
        expect(proxyBalance.gt(0)).to.be.true;

        const enableModuleCalldata = gnosisSafe.interface.encodeFunctionData(
            "enableModule",
            [
                safeGiftModule.address // address module
            ]
        );
        // Get on-chain Safe transaction Data
        const aggregatedSignatures = await generateSignatures(
            gnosisSafeProxy,
            owner1Wallet,
            owner2Wallet,
            enableModuleCalldata,
            gnosisSafeProxy.address,
            undefined
        )
        // Execute SafeGiftModule enable transaction via Safe multisig
        await gnosisSafeProxy.execTransaction(
            gnosisSafeProxy.address, // address to,
            0, // uint256 value,
            enableModuleCalldata, // bytes calldata data,
            0, // Enum.Operation operation,
            0, // uint256 safeTxGas,
            0, // uint256 baseGas,
            0, // uint256 gasPrice,
            ADDRESS_0, // address gasToken,
            ADDRESS_0, // address payable refundReceiver,
            aggregatedSignatures // bytes memory signatures
        );
        // Control expected side-effect
        expect(await gnosisSafeProxy.isModuleEnabled(safeGiftModule.address)).to.be.true;
    });

    describe("setExpiry integration test", () => {
        it('Check onlyOwner reverts when non-owner calls resricted method', async () => {
            const theBlock = await ethers.provider.getBlock(BLOCK_NUMBER);
            const theBlockTimestamp = ethers.BigNumber.from(theBlock.timestamp);
            expect(safeGiftModule.connect(deployer).setExpiry(theBlockTimestamp.add(theBlockTimestamp))).to.be.revertedWith("SafeGiftModule: onlyOwner");
        });

        it('Check setExpiry call leads to expected side-effect', async () => {
            const theBlock = await ethers.provider.getBlock(BLOCK_NUMBER);
            const theBlockTimestamp = ethers.BigNumber.from(theBlock.timestamp);
            const newExpiry = theBlockTimestamp.add(theBlockTimestamp);

            const expiryBefore = ethers.BigNumber.from(await safeGiftModule.connect(owner1).expiry());
            await safeGiftModule.connect(owner1).setExpiry(theBlockTimestamp.add(theBlockTimestamp));
            const expiryAfter = ethers.BigNumber.from(await safeGiftModule.connect(owner1).expiry());
            expect(expiryAfter.eq(expiryBefore)).to.be.false;
            expect(expiryAfter.eq(newExpiry)).to.be.true;
        });
    });

    describe("takeTheGift integration test", () => {
        const GIFT_NONCE = 42;
        const PREDEFINED_GIFT_ADDRESS = "0x0000000000000000000000000000000000000000";
        const GIFT_AMOUNT = 10;
        let GIFT_SIGNATURES = "";

        it('Call of takeTheGift leads to the token hand-out', async () => {
            const transferCalldata = giftToken.interface.encodeFunctionData(
                "transfer",
                [
                    PREDEFINED_GIFT_ADDRESS, // to
                    GIFT_AMOUNT, // amount
                ]
            );
            GIFT_SIGNATURES = await generateSignatures(
                gnosisSafeProxy,
                owner1Wallet,
                owner2Wallet,
                transferCalldata,
                giftToken.address,
                GIFT_NONCE
            )
            const takerBalanceBefore = await giftToken.balanceOf(taker.address);
            await safeGiftModule.connect(taker).takeTheGift(
                GIFT_SIGNATURES,
                taker.address,
                GIFT_AMOUNT
            );
            const takerBalanceAfter = await giftToken.balanceOf(taker.address);
            expect(takerBalanceAfter.sub(takerBalanceBefore).eq(GIFT_AMOUNT)).to.be.true;
        });

        it("Reapeat of the takeTheGift call from the same taker leads to revert", async () => {
            expect(safeGiftModule.connect(taker).takeTheGift(
                GIFT_SIGNATURES,
                taker.address,
                GIFT_AMOUNT
            )).to.be.revertedWith("SafeGiftModule: You have already received the gift");
        });

        it("It's possible to get gift tokens with same signature from different accounts", async () => {
            const takerBalanceBefore = await giftToken.balanceOf(another_taker.address);
            await safeGiftModule.connect(another_taker).takeTheGift(
                GIFT_SIGNATURES,
                another_taker.address,
                GIFT_AMOUNT
            );
            const takerBalanceAfter = await giftToken.balanceOf(another_taker.address);
            expect(takerBalanceAfter.sub(takerBalanceBefore).eq(GIFT_AMOUNT)).to.be.true;
        });

        it("Check takeTheGift reverts if the deal is expired", async () => {
            // Set 0 expiry (means the is expired)
            await safeGiftModule.connect(owner1).setExpiry(0);

            expect(ethers.BigNumber.from(await safeGiftModule.connect(owner1).expiry()).eq(0)).to.be.true;
            expect(safeGiftModule.connect(owner1).takeTheGift(
                GIFT_SIGNATURES,
                owner1.address,
                GIFT_AMOUNT
            )).to.be.revertedWith("SafeGiftModule: The gift deal is expired");
        });
    });
});