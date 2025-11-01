import {
    Connection,
    Keypair,
    VersionedTransaction,
    TransactionSignature,
    Finality,
    TransactionConfirmationStatus,
    TransactionExpiredBlockheightExceededError,
    PublicKey
} from '@solana/web3.js';
import { createJupiterApiClient, QuoteResponse, SwapInfoToJSON } from '@jup-ag/api';
import * as dotenv from 'dotenv';
import bs58 from 'bs58';

import { PumpAmmSdk, SwapSolanaState, OnlinePumpAmmSdk, buyBaseInput } from "@pump-fun/pump-swap-sdk";

// Initialize SDK
const pumpAmmSdk = new PumpAmmSdk();

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Polls the cluster for the transaction status using getSignatureStatuses.
 * This is the alternative to confirmTransaction() when no WSS endpoint is available.
 * * @param connection The Solana Connection object (HTTP-only is fine).
 * @param signature The transaction signature (txid) to check.
 * @param lastValidBlockHeight The block height at which the transaction is no longer valid.
 * @param commitment The desired commitment level ('confirmed' or 'finalized').
 * @param timeoutMs The maximum time to poll before giving up (defaults to 30000ms/30s).
 * @returns A promise that resolves when the transaction is confirmed or rejects on failure/timeout.
 */
export async function pollTransactionConfirmation(
    connection: Connection,
    signature: TransactionSignature,
    lastValidBlockHeight: number,
    commitment: Finality = 'confirmed',
    timeoutMs: number = 30000,
): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 1000; // Check status every 1 second
    
    // We also need to monitor the network's current block height to check for blockhash expiry
    const blockheightPollInterval = 2000; 
    let lastBlockHeightCheck = 0;

    // Use an error that's already defined in @solana/web3.js for consistency
    const timeoutError = new Error(`Transaction confirmation timed out after ${timeoutMs}ms.`);

    while (Date.now() - startTime < timeoutMs) {
        try {
            // 1. Check current status
            const statusResponse = await connection.getSignatureStatuses([signature], {
                searchTransactionHistory: true, // Recommended to find older transactions
            });

            const status = statusResponse.value[0];

            if (status) {
                if (status.err) {
                    // Transaction failed on-chain
                    throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
                }

                const confirmationStatus = status.confirmationStatus as TransactionConfirmationStatus;
                
                // If it reached the desired commitment, we are done
                if (
                    confirmationStatus === commitment || 
                    confirmationStatus === 'finalized'
                ) {
                    return; // Success!
                }
            }

            // 2. Check for blockhash expiration (optional but recommended for robustness)
            if (Date.now() - lastBlockHeightCheck > blockheightPollInterval) {
                const currentBlockHeight = await connection.getBlockHeight(commitment);

                if (currentBlockHeight > lastValidBlockHeight) {
                    // The blockhash has expired; the transaction will not land.
                    throw new TransactionExpiredBlockheightExceededError(
                        'Transaction signature is not found and its blockhash has expired.'
                    );
                }
                lastBlockHeightCheck = Date.now();
            }

        } catch (error) {
            // Re-throw any critical errors immediately
            if (error instanceof Error && error.message.includes('failed to get signature status')) {
                // This typically means a temporary RPC issue; continue polling
            } else if (error instanceof TransactionExpiredBlockheightExceededError) {
                throw error;
            } else if (error instanceof Error && error.message.includes('Transaction failed:')) {
                throw error;
            }
        }

        // Wait before the next poll attempt
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    // If the loop completes without success, throw a timeout error
    throw timeoutError;
}

// Load environment variables
dotenv.config();

// --- Configuration ---
const RPC_ENDPOINT = process.env.RPC_ENDPOINT;
const WALLET_SECRET_KEY = process.env.WALLET_SECRET_KEY;
const JUPITER_API_URL = process.env.JUPITER_API_URL;
// Token Mints (Example: WETH to ASSDAQ)
const WETH_MINT = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'; // WETH on sol
const ASSDAQ_MINT = '7Tx8qTXSakpfaSFjdztPGQ9n2uyT1eUkYz7gYxxopump'; // ASSDAQ on sol
const ASSDAQ_CA_ETH = '0xF4F53989d770458B659f8D094b8E31415F68A4Cf';
const WETH_CA_ETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const SLIPPAGE_BPS = 50; // 50 basis points = 0.5%
function loadWallet(): Keypair {
    if (!WALLET_SECRET_KEY) {
        throw new Error("WALLET_SECRET_KEY not set in .env");
    }
    try {
        // Handle Base58 encoded string
        return Keypair.fromSecretKey(bs58.decode(WALLET_SECRET_KEY));
    } catch (e) {
        // Fallback: Handle array string (e.g., "[1, 2, 3, ...]")
        try {
            const secretKeyArray = JSON.parse(WALLET_SECRET_KEY) as number[];
            return Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
        } catch (error) {
            throw new Error("Invalid WALLET_SECRET_KEY format.");
        }
    }
}

if (!RPC_ENDPOINT) {
    throw new Error("RPC_ENDPOINT not set in .env");
}

// 1. Setup
const wallet = loadWallet();
const connection = new Connection(RPC_ENDPOINT, 'confirmed');
const onlinePumpAmm = new OnlinePumpAmmSdk(connection);
// Using the public API client for simplicity.
const jupiter = createJupiterApiClient({ basePath: JUPITER_API_URL });

console.log(`Solana Wallet Public Key: ${wallet.publicKey.toBase58()}`);

async function quote(inputMint: string, outputMint: string, inputAmount: number): Promise<QuoteResponse> {
    // 2. Get Quote
    // console.log(`\n--- 1. Fetching quote for ${inputAmount} ${inputMint} to ${outputMint}... ---`);
    const quoteResponse = await jupiter.quoteGet({
        inputMint: inputMint,
        outputMint: outputMint,
        amount: inputAmount,
        slippageBps: SLIPPAGE_BPS,
    });

    if (!quoteResponse.routePlan) {
        console.error("No route found for the swap.");
        throw new Error("No route found for the swap.");
    }

    // console.log(`Best route found with a gross ${quoteResponse.routePlan.length} step(s).`);
    // console.log(`Out Amount (Estimated): ${Number(quoteResponse.outAmount)} ${outputMint}`);
    return quoteResponse;
}

async function swap(quoteResponse: QuoteResponse) {
    // 3. Get Swap Transaction
    console.log("\n--- 2. Getting swap transaction... ---");
    const swapResponse = await jupiter.swapPost({
        swapRequest: {
            quoteResponse: quoteResponse,
            userPublicKey: wallet.publicKey.toBase58(),
            wrapAndUnwrapSol: true, // Automatically handle SOL wrapping/unwrapping
            // prioritizationFeeLamports: "10000" // Optional: Include priority fee
        }
    });
    
    // Deserialize and sign the transaction
    const swapTransactionBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet]);

    // 4. Send and Confirm Transaction
    console.log("\n--- 3. Sending and confirming transaction... ---");
    
    // Get latest blockhash for confirmation
    const latestBlockhash = await connection.getLatestBlockhash();
    
    const rawTransaction = transaction.serialize();
    const txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 2,
    });

    console.log(`Transaction Signature: ${txid}`);
    

    // Assuming 'txid', 'latestBlockhash', and 'connection' are defined from previous steps
    try {
        await pollTransactionConfirmation(
            connection,
            txid,
            latestBlockhash.lastValidBlockHeight,
            'confirmed' // The desired commitment level
        );

        // 🎉 If the code reaches here, the transaction is successfully confirmed.
        console.log(`Transaction ${txid} successfully confirmed at 'confirmed' commitment.`);

    } catch (error) {
        // ❌ Handle errors like transaction failure or blockhash expiration
        console.error("Transaction confirmation failed:", error);
        // You might want to re-throw or handle the error appropriately here
        throw error; 
    }
}

import { BigNumberish, ethers } from "ethers";
import { NttBindings } from '@wormhole-foundation/sdk-evm-ntt/dist/cjs/bindings';
dotenv.config();


// --- Setup ---
const provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/BdKRFPCNpdIYGuvM6ltQV");
const ethWallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY || '', provider);

// --- Uniswap V2 contracts ---
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // mainnet

const pairAbi = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const routerAbi = [
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

// --- Helpers ---
async function getPairReserves(tokenIn: string, tokenOut: string) {
  const pairAddress = '0x73F09132c1eA8BCfceBDc337361830E56dcb6645';

  const pair = new ethers.Contract(pairAddress, pairAbi, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();

  let reserveIn, reserveOut;
  if (tokenIn.toLowerCase() === token0.toLowerCase()) {
    reserveIn = reserve0;
    reserveOut = reserve1;
  } else {
    reserveIn = reserve1;
    reserveOut = reserve0;
  }

  return { reserveIn, reserveOut, pairAddress };
}

function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

function getAmountOutPumpSwap(amountIn: number, baseAmount: number, quoteAmount: number) {
    const amountInWithFee = amountIn * 990;
    const numerator = amountInWithFee * baseAmount;
    const denominator = quoteAmount * 1000 + amountInWithFee;
    return numerator / denominator;
}

async function simpleSwapEthForAssdaq() {
  const tokenIn = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
  const tokenOut = "0xF4F53989d770458B659f8D094b8E31415F68A4Cf"; // ASSDAQ
  const amountIn = ethers.parseEther("0.0005"); // ethers.parseUnits("0.0005", 18); //
  const to = await ethWallet.getAddress();

  // --- Get reserves and compute expected out ---
  const { reserveIn, reserveOut, pairAddress } = await getPairReserves(tokenIn, tokenOut);
  const expectedAmountOut = getAmountOut(amountIn, reserveIn, reserveOut);

  console.log("Pair:", pairAddress);
  console.log("Reserves In:", reserveIn.toString());
  console.log("Reserves Out:", reserveOut.toString());
  console.log("Expected amount out:", ethers.formatEther(expectedAmountOut));

  // --- Create token + router contracts ---
  const tokenInContract = new ethers.Contract(tokenIn, erc20Abi, ethWallet);
  const tokenOutContract = new ethers.Contract(tokenOut, erc20Abi, ethWallet);
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, ethWallet);

  // --- Approve router if needed ---
  const allowance = await tokenInContract.allowance(to, UNISWAP_V2_ROUTER);
  if (allowance < amountIn) {
    console.log("Approving...");
    const tx = await tokenInContract.approve(UNISWAP_V2_ROUTER, amountIn);
    await tx.wait();
  }

  // --- Balances before ---
  const balanceBefore = await tokenOutContract.balanceOf(to);

  // --- Execute swap ---
  console.log("Swapping...");
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes
  const path = [tokenIn, tokenOut];
  const tx = await router.swapExactETHForTokens(
    expectedAmountOut * 99n / 100n, // 1% slippage tolerance
    path,
    to,
    deadline,
    { value: amountIn },
  );
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Swap confirmed in block:", receipt.blockNumber);

  // --- Balances after ---
  const balanceAfter = await tokenOutContract.balanceOf(to);
  const received = balanceAfter - balanceBefore;

  console.log("Received:", ethers.formatEther(received), "tokenOut");
}

// simpleSwapEthForAssdaq().catch(console.error);

async function main() {

    // TODO ternary search for quote where arbitrage is positive and max value
    // ternary because there is 1 local maximum 
    // first 10 iterations sell on sol buy on eth:
    // 
    // implement something similar to :
    /*
    async function findBestArbInput(minInput: number, maxInput: number, iterations = 12) {
  let bestInput = minInput;
  let bestProfit = -Infinity;

  for (let i = 0; i < iterations; i++) {
    const left = minInput + (maxInput - minInput) / 3;
    const right = maxInput - (maxInput - minInput) / 3;

    const profitLeft = await simulateProfit(left);
    const profitRight = await simulateProfit(right);

    console.log(
      `Iter ${i}: [${(minInput/1e6).toFixed(0)}, ${(maxInput/1e6).toFixed(0)}] — L=${(left/1e6).toFixed(0)} P=${(profitLeft/1e6).toFixed(2)}, R=${(right/1e6).toFixed(0)} P=${(profitRight/1e6).toFixed(2)}`
    );

    if (profitLeft < profitRight) {
      minInput = left;
      bestInput = right;
      bestProfit = profitRight;
    } else {
      maxInput = right;
      bestInput = left;
      bestProfit = profitLeft;
    }
  }

  return { bestInput, bestProfit };
}
  */

    const { reserveIn, reserveOut } = await getPairReserves(WETH_CA_ETH, ASSDAQ_CA_ETH);
    const WETH_RESERVES = reserveIn;
    const ASSDAQ_RESERVES = reserveOut;

    const swapSolanaState = await onlinePumpAmm.swapSolanaState(new PublicKey('8r2FgpMpJiLiHBV6tzM21TqoHgWny4vkvuaN6Rv2So2H'), wallet.publicKey);
    const { poolBaseAmount, poolQuoteAmount } = swapSolanaState;

    const wethQuote = await quote(WETH_MINT, WSOL_MINT, 10**8); // for 1 eth
    const wethPrice = Number(wethQuote.otherAmountThreshold) / (10**9); // wsol has 9 decimals
    console.log("WETH price in SOL: " + wethPrice);
    // Check sell on Sol buy on ETH:
    for (let i = 1; i <= 5000; i+=1000) {
        const inputAmount = (1000 * 10 ** 6) * i;
        // const quoteResponse = await quote(ASSDAQ_MINT, WETH_MINT, inputAmount)
        // const expectedEthOut = Number(quoteResponse.otherAmountThreshold) / (10 ** 8); //(weth has 8 decimals on sol)
        // console.log(`SOL: Expected ETH for ${Number(inputAmount / (10 ** 6))} ASSDAQ: ${expectedEthOut}`);
        const expectedEthViaPumpSwap = (getAmountOutPumpSwap(inputAmount, poolQuoteAmount, poolBaseAmount)/10**9)/wethPrice;
        console.log(`SOL(PumpSwap): Expected ETH for ${Number(inputAmount / (10 ** 6))} ASSDAQ: ${expectedEthViaPumpSwap}`);

        const amountIn = expectedEthViaPumpSwap * 10** 18; // ethers.parseEther("0.0005");
        const to = await ethWallet.getAddress();
        const tokenIn = WETH_CA_ETH;
        const tokenOut = ASSDAQ_CA_ETH;
        const expectedAmountOut = getAmountOut(BigInt(Math.floor(amountIn)), WETH_RESERVES, ASSDAQ_RESERVES);
        console.log(`ETH: Expected ASSDAQ for ${expectedEthViaPumpSwap} ETH : ${ethers.formatEther(expectedAmountOut)}`);
    }

    // Now check sell on ETH buy on SOL:
    for (let i = 1; i <= 5000; i*=1000) {
        const tokenIn = ASSDAQ_CA_ETH;
        const tokenOut = WETH_CA_ETH;
        const inAssdaq = 1000 * i;
        const amountIn = ethers.parseUnits(String(inAssdaq), 18); // ethers.parseEther("0.0005");
        const to = await ethWallet.getAddress();
        const expectedAmountOut = getAmountOut(amountIn, ASSDAQ_RESERVES, WETH_RESERVES);
        console.log(`ETH: Expected ETH for ${inAssdaq} ASSDAQ : ${ethers.formatEther(expectedAmountOut)}`);

        const inputAmount = Number(expectedAmountOut) / 10 ** 18;
        // const quoteResponse = await quote(WETH_MINT, ASSDAQ_MINT, Math.floor(Number(expectedAmountOut) / 10 ** 10)); // remove 10 numbers because WETH on sol has 9 decimals and on eth 18
        // const expectedAssdaqOut = Number(quoteResponse.otherAmountThreshold) / (10 ** 6); //(assdaq has 6 decimals on sol)
        // console.log(`SOL: Expected ASSDAQ for ${inputAmount} WETH: ${expectedAssdaqOut}`);
        const expectedASSDAQViaPumpSwap = getAmountOutPumpSwap(inputAmount*wethPrice*10**9, poolBaseAmount, poolQuoteAmount)/10**6;
        console.log(`SOL(PumpSwap): Expected ASSDAQ for ${Number(inputAmount)} WETH: ${expectedASSDAQViaPumpSwap}`);
    }
}

main().catch(err => {
    console.error("An error occurred in main function:", err);
});