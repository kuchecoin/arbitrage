import { ethers } from "ethers";

// Types to keep data organized
export enum RouteDirection {
    ETH_TO_SOL = 'SELL ON ETH BUY ON SOL',
    SOL_TO_ETH = 'SELL ON SOL BUY ON ETH',
    NONE = 'N/A'
}

export interface PoolState {
    // Uniswap Reserves (ETH/ASSDAQ)
    ethReserveIn: bigint;  // WETH Amount
    ethReserveOut: bigint; // ASSDAQ Amount
    
    // Pump.fun Virtual Reserves
    solPoolBase: number;   // Base virtual reserves
    solPoolQuote: number;  // Quote virtual reserves
    
    // Prices & Constants
    wethPriceInSol: number; 
}

export interface ArbitrageResult {
    route: RouteDirection;
    inputAmount: number;     // Amount of ASSDAQ to swap
    expectedProfitSol: number;
    expectedProfitAssdaq: number;
    crossChainAmount: number;     // The "expectedEth" (Amount to swap on the other chain)
}

export class ArbitrageCalculator {
    // Constants from original code
    private static readonly UNISWAP_FEE = 997n;
    private static readonly UNISWAP_DENOM = 1000n;
    private static readonly PUMP_FEE = 990;
    private static readonly PUMP_DENOM = 1000;

    /**
     * Pure Math: Uniswap V2 Constant Product Formula
     * (x * y = k)
     */
    public getUniswapAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
        if (amountIn <= 0n) return 0n;
        const amountInWithFee = amountIn * ArbitrageCalculator.UNISWAP_FEE;
        const numerator = amountInWithFee * reserveOut;
        const denominator = (reserveIn * ArbitrageCalculator.UNISWAP_DENOM) + amountInWithFee;
        return numerator / denominator;
    }

    /**
     * Pure Math: Pump.fun Bonding Curve Formula
     */
    public getPumpAmountOut(amountIn: number, baseRes: number, quoteRes: number): number {
        if (amountIn <= 0) return 0;
        const amountInWithFee = amountIn * ArbitrageCalculator.PUMP_FEE;
        const numerator = amountInWithFee * baseRes;
        const denominator = (quoteRes * ArbitrageCalculator.PUMP_DENOM) + amountInWithFee;
        return numerator / denominator;
    }

    /**
     * Main Logic: Iterates through amount ranges to find the best profit.
     * @param balances - Current wallet balances
     * @param pools - Current state of Uniswap and Pump pools
     */
    public findBestArbitrage(
        currentAssdaqSol: number,
        currentAssdaqEth: number,
        currentWethSol: number,
        currentEthOnEth: number,
        pools: PoolState
    ): ArbitrageResult {
        
        // Configuration for the loop (from original)
        const endSol = Math.floor(currentAssdaqSol);
        const endEth = Math.floor(currentAssdaqEth);
        const step = 10; // Check every 10 tokens

        let bestV = 0; // Best profit (in ASSDAQ terms)
        let bestI = -1; // Best Input Amount
        let bestRoute = RouteDirection.NONE;
        let finalExpectedEth = 0;
        let crossChainAmount = -1;

        // -------------------------------------------------------
        // ROUTE 1: Sell on SOL (Pump) -> Buy on ETH (Uniswap)
        // -------------------------------------------------------
        for (let i = 1; i <= endSol; i += step) {
            const inputAssdaqRaw = (10 ** 6) * i; // ASSDAQ has 6 decimals on SOL

            // 1. Sell ASSDAQ on Pump for SOL (Virtual Quote/Base swap)
            // Result is in Lamports/Virtual Units, need to convert to logical ETH equivalent
            // Original logic: (Output / 10^9) / WethPrice
            const solReceivedRaw = this.getPumpAmountOut(inputAssdaqRaw, pools.solPoolQuote, pools.solPoolBase);
            const solReceived = solReceivedRaw / (10 ** 9); 
            const expectedEthFromSol = solReceived / pools.wethPriceInSol;

            // Liquidity Safety Check
            if (expectedEthFromSol > 0.9 * currentEthOnEth) break;

            // 2. Buy ASSDAQ on Uniswap with that ETH
            const amountInWei = ethers.parseEther(expectedEthFromSol.toFixed(18)); // Convert to Wei
            
            const assdaqReceivedWei = this.getUniswapAmountOut(
                amountInWei, 
                pools.ethReserveIn, 
                pools.ethReserveOut
            );
            const assdaqReceived = Number(ethers.formatEther(assdaqReceivedWei)); // Assuming 18 decimals on Eth side for math

            // 3. Profit Check
            if (assdaqReceived > i && (assdaqReceived - i) > bestV) {
                bestI = i;
                bestV = assdaqReceived - i;
                finalExpectedEth = expectedEthFromSol;
                bestRoute = RouteDirection.SOL_TO_ETH; // sell on sol buy on eth
                crossChainAmount = finalExpectedEth;
            }
        }

        // -------------------------------------------------------
        // ROUTE 2: Sell on ETH (Uniswap) -> Buy on SOL (Pump)
        // -------------------------------------------------------
        for (let i = 1; i <= endEth; i += step) {
            const inputAssdaq = i; // Whole tokens
            const amountInWei = ethers.parseUnits(inputAssdaq.toString(), 18); // ASSDAQ Eth decimals

            // 1. Sell ASSDAQ on Uniswap for ETH
            const ethReceivedWei = this.getUniswapAmountOut(
                amountInWei,
                pools.ethReserveOut, // ReserveIn (ASSDAQ)
                pools.ethReserveIn   // ReserveOut (WETH)
            );
            
            const ethReceived = Number(ethers.formatEther(ethReceivedWei));

            // Liquidity Check
            if (ethReceived > 0.9 * currentWethSol) break;

            // 2. Buy ASSDAQ on Pump with that ETH (converted to SOL value)
            // Value in SOL = ETH * Price
            const valueInSol = ethReceived * pools.wethPriceInSol;
            const valueInLamports = valueInSol * (10 ** 9);

            const assdaqReceivedRaw = this.getPumpAmountOut(
                valueInLamports,
                pools.solPoolBase, 
                pools.solPoolQuote
            );
            const assdaqReceived = assdaqReceivedRaw / (10 ** 6);

            // 3. Profit Check
            if (assdaqReceived > i && (assdaqReceived - i) > bestV) {
                bestV = assdaqReceived - i;
                bestI = i;
                bestRoute = RouteDirection.ETH_TO_SOL; // sell on eth buy on sol
                crossChainAmount = ethReceived;
            }
        }

        // Calculate Final Profit in SOL for threshold checking
        // This converts the ASSDAQ profit (bestV) into SOL
        let expectedProfitSol = 0;
        if (bestV > 0) {
             // Simple estimation of profit value
             const approxSolValue = (bestV * 10**6) * (pools.solPoolQuote / pools.solPoolBase); 
             expectedProfitSol = approxSolValue / 10**9; 
             // Or utilize the quote function from the service layer later for accuracy
        }

        return {
            route: bestRoute,
            inputAmount: bestI,
            expectedProfitAssdaq: bestV,
            expectedProfitSol: expectedProfitSol,
            crossChainAmount: crossChainAmount
        };
    }
}