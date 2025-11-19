import { Connection, Finality, TransactionConfirmationStatus, TransactionExpiredBlockheightExceededError, TransactionSignature } from "@solana/web3.js";

/**
 * Polls the cluster for the transaction status using getSignatureStatuses.
 * This is the alternative to confirmTransaction() when no WSS endpoint is available.
 * @param connection The Solana Connection object (HTTP-only is fine).
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
