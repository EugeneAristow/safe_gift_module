import { ethers, network, config } from "hardhat";
import { expect } from "chai";

const ADDRESS_0 = "0x0000000000000000000000000000000000000000"

const forkSpecificState = async (blockNumber = 18127149) => {
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

describe ("SafeGiftModule integration tests", () => {
    let deployer, owner1, owner2, taker: ethers.SignerWithAddress;
    let owner1Wallet, owner2Wallet: ethers.Wallet;
    let safeGiftModule: ethers.Contract;

    let gnosisSafeProxyFactory: ethers.Contract;
    let gnosisSafeProxy: ethers.Contract;
    let gnosisSafe: ethers.Contract; // Singleton

    let giftToken: ethers.Contract;

    before(async function () {
        await forkSpecificState();
        // Access some deafult signers
        [deployer, owner1, owner2, taker] = await ethers.getSigners();
        // Get 'owner1', 'owner2' PKs for further signature generating
        const accounts = config.networks.hardhat.accounts;
        owner1Wallet = ethers.Wallet.fromMnemonic(accounts.mnemonic, accounts.path + `/${1}`);
        owner2Wallet = ethers.Wallet.fromMnemonic(accounts.mnemonic, accounts.path + `/${2}`);

        const testTokenCF = await ethers.getContractFactory("TestToken");
        giftToken = await testTokenCF.connect(deployer).deploy();

        const gnosisSafeProxyFactoryCF = await ethers.getContractFactory("GnosisSafeProxyFactory");
        gnosisSafeProxyFactory = await gnosisSafeProxyFactoryCF.connect(deployer).deploy();

        // Create Singleton
        const gnosisSafeCF = await ethers.getContractFactory("GnosisSafe");
        gnosisSafe = await gnosisSafeCF.connect(deployer).deploy();

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

        // Send all minted tokens to Mutlisig
        await giftToken.connect(deployer).transfer(
            gnosisSafeProxy.address, await giftToken.connect(deployer).balanceOf(deployer.address));

        const enableModuleCalldata = gnosisSafe.interface.encodeFunctionData(
            "enableModule",
            [
                safeGiftModule.address // address module
            ]
        );
        // Get on-chain Safe transaction Data
        const enableModuleSafeTxData = await gnosisSafeProxy.encodeTransactionData(
            gnosisSafeProxy.address, // address to,
            0, // uint256 value,
            enableModuleCalldata, // bytes calldata data,
            0, // Enum.Operation operation,
            0, // uint256 safeTxGas,
            0, // uint256 baseGas,
            0, // uint256 gasPrice,
            ADDRESS_0, // address gasToken,
            ADDRESS_0, // address refundReceiver,
            await gnosisSafeProxy.nonce() // uint256 _nonce
        );
        // Get on-chain Safe transaction hash to be signed
        const enableModuleSafeTxHash = await gnosisSafeProxy.getTransactionHash(
            gnosisSafeProxy.address, // address to,
            0, // uint256 value,
            enableModuleCalldata, // bytes calldata data,
            0, // Enum.Operation operation,
            0, // uint256 safeTxGas,
            0, // uint256 baseGas,
            0, // uint256 gasPrice,
            ADDRESS_0, // address gasToken,
            ADDRESS_0, // address refundReceiver,
            await gnosisSafeProxy.nonce() // uint256 _nonce
        );

        // Generate signatures from enableModuleSafeTxHash
        const signature1 = owner1Wallet._signingKey().signDigest(enableModuleSafeTxHash);
        const aggregatedSignature1 = signature1.r + signature1.s.substr(2) + ethers.utils.hexlify(signature1.v).substr(2);
        const signature2 = owner2Wallet._signingKey().signDigest(enableModuleSafeTxHash);
        const aggregatedSignature2 = signature2.r + signature2.s.substr(2) + ethers.utils.hexlify(signature2.v).substr(2);
        const aggregatedSignatures = aggregatedSignature2 + aggregatedSignature1.substr(2);
        await gnosisSafeProxy.checkSignatures(
            enableModuleSafeTxHash, // bytes32 dataHash,
            enableModuleSafeTxData, // bytes memory data,
            aggregatedSignatures // bytes memory signatures
        );
        // Execute transaction via Safe multisig
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

    it('Sample test', async () => {
    });
});