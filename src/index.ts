import {
    Connection,
    Keypair,
    VersionedTransaction,
    TransactionSignature,
    Finality,
    TransactionConfirmationStatus,
    TransactionExpiredBlockheightExceededError
} from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import * as dotenv from 'dotenv';
import bs58 from 'bs58';


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

// Token Mints (Example: SOL to USDC)
const INPUT_MINT_ADDRESS = 'So11111111111111111111111111111111111111112'; // SOL
const OUTPUT_MINT_ADDRESS = '7Tx8qTXSakpfaSFjdztPGQ9n2uyT1eUkYz7gYxxopump'; // ASSDAQ
const AMOUNT_TO_SWAP = 0.001; // 0.01 SOL (as a whole number)
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

async function main() {
    if (!RPC_ENDPOINT) {
        throw new Error("RPC_ENDPOINT not set in .env");
    }

    // 1. Setup
    const wallet = loadWallet();
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    // Using the public API client for simplicity.
    const jupiter = createJupiterApiClient({ basePath: JUPITER_API_URL });

    console.log(`Wallet Public Key: ${wallet.publicKey.toBase58()}`);

    // Convert floating point amount to the smallest unit (lamports/nanotokens)
    // SOL has 9 decimals. Other tokens may vary (e.g., USDC has 6).
    const inputAmount = AMOUNT_TO_SWAP * 10 ** 9;

    // 2. Get Quote
    console.log(`\n--- 1. Fetching quote for ${AMOUNT_TO_SWAP} SOL to ASSDAQ... ---`);
    const quoteResponse = await jupiter.quoteGet({
        inputMint: INPUT_MINT_ADDRESS,
        outputMint: OUTPUT_MINT_ADDRESS,
        amount: inputAmount,
        slippageBps: SLIPPAGE_BPS,
    });

    if (!quoteResponse.routePlan) {
        console.error("No route found for the swap.");
        return;
    }

    console.log(`Best route found with a gross ${quoteResponse.routePlan.length} step(s).`);
    console.log(`Out Amount (Estimated): ${Number(quoteResponse.outAmount) / 10**6} ASSDAQ`); // USDC has 6 decimals

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

main().catch(err => {
    console.error("An error occurred in main function:", err);
});