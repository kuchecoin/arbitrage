import * as dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
    RPC: {
        SOLANA: process.env.RPC_ENDPOINT || '',
        ETHEREUM: process.env.ETH_RPC_ENDPOINT || '',
        HELIUS: process.env.SOLANA_HELIUS_ENDPOINT || '',
    },
    WALLETS: {
        SOLANA_SECRET: process.env.WALLET_SECRET_KEY || '',
        ETH_PRIVATE_KEY: process.env.ETH_PRIVATE_KEY || '',
    },
    TOKENS: {
        SOL: {
            WSOL_MINT: 'So11111111111111111111111111111111111111112',
            WETH_MINT: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
            ASSDAQ_MINT: '7Tx8qTXSakpfaSFjdztPGQ9n2uyT1eUkYz7gYxxopump',
        },
        ETH: {
            WETH_CA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            ASSDAQ_CA: '0xF4F53989d770458B659f8D094b8E31415F68A4Cf',
            ASSDAQ_ETH_PAIR_ADDRESS: '0x73F09132c1eA8BCfceBDc337361830E56dcb6645',
        }
    },
    UNISWAP: {
        V2_ROUTER: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    },
    JUPITER: {
        API_URL: process.env.JUPITER_API_URL,
        SLIPPAGE_BPS: 50, // 50 basis points = 0.5%
    },
    PROFIT_TRESHOLD_IN_SOL: 0.01,
    SLEEP_BETWEEN_ITERATIONS_MS: 30000,
    SOL_THRESHOLD_TO_SELL_WHEN_ABOVE_IT: 1.99,
    SOL_TO_LEAVE: 1,
    PERCENT_FOR_REBALANCE: .25,
    TARGET_PERCENT: .5,
    PUMP_FUN_ASSDAQ_CURVE_ADDR: '8r2FgpMpJiLiHBV6tzM21TqoHgWny4vkvuaN6Rv2So2H',
};

export const ABIS = {
    ERC20: [
        "function decimals() view returns (uint8)",
        "function balanceOf(address account) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)"
    ],
    UNISWAP_PAIR: [
        "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
        "function token0() external view returns (address)",
        "function token1() external view returns (address)"
    ],
    V2_ROUTER: [
        "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
        "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
    ]
};
