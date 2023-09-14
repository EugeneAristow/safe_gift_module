# SafeGiftModule

SafeGiftModule smart contract is GnosisSafe module which supports the token
hand-out mechanism. The module is bound to specific GnosisSafe instance and
specific token. An account is able to request the gift deal tokens via
'takeTheGift' external method in case it passes related GnosisSafe owners
signatures considering set threshold.

To run auto-tests in local mainnet fork:

0. Set up environment and install required packages
```shell
   npm i
```shell
1. Set the provider URL in .env.example and copy it to .env
```shell
   cp .env.example .env
```shell
2. Run following command
```shell
    npx hardhat tests
```shell
Expected: all tests are passed