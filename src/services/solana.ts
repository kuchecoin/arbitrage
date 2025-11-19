import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createJupiterApiClient, QuoteResponse } from '@jup-ag/api';
import bs58 from 'bs58';
import { OnlinePumpAmmSdk } from "@pump-fun/pump-swap-sdk";
import { CONFIG } from '../config';
import { pollTransactionConfirmation } from '../utils/transaction';

export class SolanaService {
    connection: Connection;
    wallet: Keypair;
    jupiter: ReturnType<typeof createJupiterApiClient>;
    pumpSdk: OnlinePumpAmmSdk;

    constructor() {
        this.connection = new Connection(CONFIG.RPC.SOLANA, 'confirmed');
        this.wallet = this.loadWallet();
        this.jupiter = createJupiterApiClient({ basePath: CONFIG.JUPITER.API_URL });
        this.pumpSdk = new OnlinePumpAmmSdk(this.connection);
    }

    private loadWallet(): Keypair {
        if (!CONFIG.WALLETS.SOLANA_SECRET) throw new Error("Missing SOL secret");
        try {
            return Keypair.fromSecretKey(bs58.decode(CONFIG.WALLETS.SOLANA_SECRET));
        } catch {
            const arr = JSON.parse(CONFIG.WALLETS.SOLANA_SECRET);
            return Keypair.fromSecretKey(Uint8Array.from(arr));
        }
    }

    async getSolBalance(): Promise<number> {
        const bal = await this.connection.getBalance(this.wallet.publicKey, 'confirmed');
        return bal / 1e9;
    }

    async getSPLBalance(mint: string): Promise<number> {
        try {
            const token = new Token(this.connection, new PublicKey(mint), TOKEN_PROGRAM_ID, {
                publicKey: this.wallet.publicKey,
                secretKey: undefined as any,
            });
            const info = await token.getOrCreateAssociatedAccountInfo(this.wallet.publicKey);
            const mintInfo = await token.getMintInfo();
            return Number(info.amount) / (10 ** mintInfo.decimals);
        } catch (e) {
            return 0;
        }
    }

    async getPumpCurveState(curveAddr: string) {
        return await this.pumpSdk.swapSolanaState(new PublicKey(curveAddr), this.wallet.publicKey);
    }

    // Math for Pump Fun
    calculatePumpOut(amountIn: number, baseRes: number, quoteRes: number) {
        const amountInWithFee = amountIn * 990;
        const numerator = amountInWithFee * baseRes;
        const denominator = quoteRes * 1000 + amountInWithFee;
        return numerator / denominator;
    }

    async getQuote(inputMint: string, outputMint: string, amount: number): Promise<QuoteResponse> {
        const quote = await this.jupiter.quoteGet({
            inputMint, outputMint, amount, slippageBps: CONFIG.JUPITER.SLIPPAGE_BPS
        });
        if (!quote.routePlan) throw new Error("No route found");
        return quote;
    }

    async executeSwap(quoteResponse: QuoteResponse) {
        console.log(`Executing Jupiter Swap... `+
            `Input mint: (${quoteResponse.inputMint}), ` +
            `Output mint: (${quoteResponse.outputMint}), ` +
            `Input Amount: (${quoteResponse.inAmount}), ` +
            `Output Amount: (${quoteResponse.outAmount})`);
        const { swapTransaction } = await this.jupiter.swapPost({
            swapRequest: {
                quoteResponse,
                userPublicKey: this.wallet.publicKey.toBase58(),
                wrapAndUnwrapSol: true,
            }
        });

        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([this.wallet]);

        const latestBh = await this.connection.getLatestBlockhash();
        const txid = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 });
        
        console.log(`Tx Sent: ${txid}`);
        await pollTransactionConfirmation(this.connection, txid, latestBh.lastValidBlockHeight);
        console.log(`${txid} Swap Confirmed`);
    }
}