import { Ntt } from "@wormhole-foundation/sdk-definitions-ntt";
import { Chain, encoding } from "@wormhole-foundation/sdk";

export type NttContracts = {
  [key in Chain]?: Ntt.Contracts;
};

export const NTT_TOKENS: NttContracts = {
  Solana: {
    token: "7Tx8qTXSakpfaSFjdztPGQ9n2uyT1eUkYz7gYxxopump",
    manager: "NTtqw55qyL2582gLjVoDTYKHTUwFbUAwgui8UN6nVrn",
    transceiver: {
      wormhole: "8BFpjjxeEP4ZVEvf33nbsW1ZgRiMR6YMPrmYdp6EescY",
    },
  },
  Base: {
    token: "0xAE60f142a02825C31E199C7c381aC94F287E34D2",
    manager: "0xb6209417534E1EE9b6484ea9489dB7382f094E89",
    transceiver: { wormhole: "0xAA17616bD9Dcb362c62E8E117bb41048085bfa81" },
  },
};