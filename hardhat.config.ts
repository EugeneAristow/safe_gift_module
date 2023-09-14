import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.19",
        settings: {
          optimizer: {
            enabled: true,
            runs: 100,
          },
        }
      },
      {
        version: "0.6.5",
        settings: {
          optimizer: {
            enabled: true,
            runs: 100,
          },
        }
      },
   ]
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.PROVIDER_URL ?? "",
      },
      // Specify desired chain id for fork here.
      // Default hardhat chain id is 31337.
      // chainId:,
    },
  },
};

export default config;
