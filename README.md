# Arbitrage bot for ASSDAQ on ETH and Solana

# Fill .env with the following variables:

# Replace with a valid Solana RPC endpoint (e.g., from QuickNode, Helius, or a public one)
SOLANA_HELIUS_ENDPOINT="https://mainnet.helius-rpc.com/?api-key=###"
RPC_ENDPOINT="https://solana-mainnet.g.alchemy.com/v2/###"
BASE_RPC_ENDPOINT="https://base-mainnet.g.alchemy.com/v2/###"
ETH_RPC_ENDPOINT="https://eth-mainnet.g.alchemy.com/v2/###"

# Your wallet's Base58 secret key (the 64-byte array from solana-keygen)
# Example: "[1, 2, 3, ...]" (array string)
WALLET_SECRET_KEY="[###,###,###,...]"

ETH_PRIVATE_KEY="###"

# Jupiter's public API endpoint
JUPITER_API_URL="https://quote-api.jup.ag/v6"

# CoinMarketCap API KEY:
CMC_API_KEY=###