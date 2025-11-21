import { CONFIG } from './config';
import { EthereumService } from './services/ethereum';
import { SolanaService } from './services/solana';
import { setupLogger, sleep } from './utils/helpers';
import { Wormhole, wormhole } from '@wormhole-foundation/sdk';
import evm from '@wormhole-foundation/sdk/evm';
import solana from '@wormhole-foundation/sdk/solana';
import { ArbitrageCalculator, PoolState, RouteDirection } from './services/calculator';

// Import bridge scripts (assuming these export functions)
import { bridgeAssdaqEthToSol } from './utils/bridge-ASSDAQ-eth-to-sol';
import { bridgeAssdaqSolToEth } from './utils/bridge-ASSDAQ-sol-to-eth';
import { bridgeEthToWethSol } from './utils/scripts/bridge-eth-to-weth-sol';
import { bridgeWethSolToEth } from './utils/scripts/bridge-weth-sol-to-eth';
import { CmcService } from './services/cmc';

setupLogger();

const ethService = new EthereumService();
const solService = new SolanaService();
const calculator = new ArbitrageCalculator();
const cmcService = new CmcService();

async function performArbitrageCheck(iteration: number, wh: Wormhole<"Mainnet">) {
    console.info(`Iteration: ${iteration}`)
    // 1. Fetch Data (Async calls)
    const [
        assdaqSol, assdaqEth, wethSol, ethEth,
        uniswapReserves, pumpCurve, solBalance, cmcPrices
    ] = await Promise.all([
        solService.getSPLBalance(CONFIG.TOKENS.SOL.ASSDAQ_MINT),
        ethService.getTokenBalance(CONFIG.TOKENS.ETH.ASSDAQ_CA),
        solService.getSPLBalance(CONFIG.TOKENS.SOL.WETH_MINT),
        ethService.getEthBalance(),
        ethService.getPairReserves(CONFIG.TOKENS.ETH.WETH_CA),
        solService.getPumpCurveState(CONFIG.PUMP_FUN_ASSDAQ_CURVE_ADDR),
        solService.getSolBalance(),
        cmcService.getEthAndSolPriceInUSD(iteration),
    ]);

    try {
        if (await handleRebalancing(solBalance, assdaqSol, assdaqEth, wethSol, ethEth, wh)) {
            console.log('Rebalance, skip arbitrage this iteration...');
            return;
        }
    } catch (error) {
        console.error('Rebalancing failed', error);
    }

    // 2. Prepare State for Calculator
    const wethPrice = cmcPrices.ethPriceUSD / cmcPrices.solPriceUSD;
    
    const poolState: PoolState = {
        ethReserveIn: uniswapReserves.reserveIn, // WETH
        ethReserveOut: uniswapReserves.reserveOut, // ASSDAQ
        solPoolBase: Number(pumpCurve.poolBaseAmount),
        solPoolQuote: Number(pumpCurve.poolQuoteAmount),
        wethPriceInSol: wethPrice
    };

    console.log(`\n---------Statistics-----------:\n`+
        `ASSDAQ on SOL: ${assdaqSol}\n` +
        `ASSDAQ on ETH: ${assdaqEth}\n` +
        `WETH on SOL: ${wethSol}\n` +
        `ETH on ETH: ${ethEth}\n` + 
        `SOL on SOL: ${solBalance}\n` +
        `ETH price in USD: ${cmcPrices.ethPriceUSD}\n` +
        `SOL price in USD: ${cmcPrices.solPriceUSD}\n` +
        `WETH price in SOL: ${wethPrice}\n` +
        `ASSDAQ in PumpSwap Pool: ${poolState.solPoolBase / 10 ** 6}\n` +
        `SOL in PumpSwap Pool: ${poolState.solPoolQuote / 10 ** 9}\n` +
        `ASSDAQ in UniSwap Pool: ${Number(poolState.ethReserveOut / 10n ** 9n) / 10 ** 9}\n` +
        `ETH in UniSwap Pool: ${Number(poolState.ethReserveIn / 10n ** 9n) / 10 ** 9}`);

    // 3. Run Calculation (Synchronous, fast, pure math)
    const result = calculator.findBestArbitrage(
        assdaqSol, assdaqEth, wethSol, ethEth, 
        poolState
    );

    // 4. Execute Decision
    if (result.route === RouteDirection.NONE) {
        console.log("No profitable route found.");
        return;
    }

    console.log(`OPPORTUNITY: ${result.route} | Input: ${result.inputAmount} | Profit (ASSDAQ): ${result.expectedProfitAssdaq}`);

    // Re-calculate accurate profit in SOL using Jupiter for final check (optional but recommended)
    const profitCheckQuote = await solService.getQuote(
        CONFIG.TOKENS.SOL.ASSDAQ_MINT, 
        CONFIG.TOKENS.SOL.WSOL_MINT, 
        Math.floor(result.expectedProfitAssdaq * 10**6)
    );
    const realProfitSol = Number(profitCheckQuote.otherAmountThreshold) / 10**9;

    if (realProfitSol > CONFIG.PROFIT_TRESHOLD_IN_SOL) {
        console.log(`Executing with projected profit: ${realProfitSol} SOL`);

        try {
            if (result.route === RouteDirection.ETH_TO_SOL) {
                // -------------------------------------------------------
                // LOGIC A: Sell ASSDAQ on ETH -> Buy ASSDAQ on SOL
                // -------------------------------------------------------
                
                console.log("Executing Route: ETH -> SOL");

                await Promise.all([
                    // 1. Solana Side: Swap WETH -> ASSDAQ
                    // We use the ETH amount calculated to buy ASSDAQ on Sol
                    // Note: Original script used 10**8 for WETH decimals on Solana
                    solService.getQuote(
                        CONFIG.TOKENS.SOL.WETH_MINT,   // Input: WETH
                        CONFIG.TOKENS.SOL.ASSDAQ_MINT, // Output: ASSDAQ
                        Math.floor(result.crossChainAmount * 10**8)
                    ).then(quote => solService.executeSwap(quote)),

                    // 2. Ethereum Side: Swap ASSDAQ -> ETH
                    // Input: The 'bestI' from the calculator
                    ethService.executeSwap(
                        CONFIG.TOKENS.ETH.ASSDAQ_CA, // Input: ASSDAQ
                        CONFIG.TOKENS.ETH.WETH_CA,   // Output: WETH (Native ETH)
                        result.inputAmount.toString(), 
                        false // isNativeIn: false (we are sending ERC20)
                    )
                ]);

            } else {
                // -------------------------------------------------------
                // LOGIC B: Sell ASSDAQ on SOL -> Buy ASSDAQ on ETH
                // -------------------------------------------------------

                console.log("Executing Route: SOL -> ETH");

                // 1. Solana Side: Swap ASSDAQ -> SOL
                // Note: Original script swapped to WSOL_MINT (So111...), not the WETH_MINT
                const solSwapPromise = solService.getQuote(
                    CONFIG.TOKENS.SOL.ASSDAQ_MINT, // Input: ASSDAQ
                    CONFIG.TOKENS.SOL.WSOL_MINT,   // Output: SOL (WSOL)
                    Math.floor(result.inputAmount * 10**6) // ASSDAQ decimals
                ).then(quote => solService.executeSwap(quote));

                // 2. Ethereum Side: Swap ETH -> ASSDAQ
                // We use the ETH result from the Sol swap to buy ASSDAQ on Eth
                const ethSwapPromise = ethService.executeSwap(
                    CONFIG.TOKENS.ETH.WETH_CA,     // Input: WETH (Native ETH)
                    CONFIG.TOKENS.ETH.ASSDAQ_CA,   // Output: ASSDAQ
                    result.crossChainAmount.toFixed(18), // Format to Wei string
                    true // isNativeIn: true (we are sending ETH)
                );

                await Promise.all([solSwapPromise, ethSwapPromise]);
            }
            
            console.log("Arbitrage execution completed.");

        } catch (error) {
            console.error("Execution failed:", error);
        }
    }
}

async function handleRebalancing(
    solBal: number, 
    assSol: number, 
    assEth: number, 
    wethSol: number, 
    ethEth: number,
    wh: Wormhole<"Mainnet">
): Promise<boolean> {
    const totalAssdaq = assSol + assEth;
    const totalEth = wethSol + ethEth;
    let res = false;

    // ---------------------------------------------------------
    // 1. Sell Excess SOL for WETH (on Solana)
    // ---------------------------------------------------------
    if (solBal > CONFIG.SOL_THRESHOLD_TO_SELL_WHEN_ABOVE_IT) {
        console.log(`Rebalance: SOL balance (${solBal}) > (${CONFIG.SOL_THRESHOLD_TO_SELL_WHEN_ABOVE_IT}). Selling excess...`);
        
        try {
            // Calculate amount to sell in Lamports
            const amountToSwapLamports = Math.floor((solBal - CONFIG.SOL_TO_LEAVE) * 1e9);
            
            const quote = await solService.getQuote(
                CONFIG.TOKENS.SOL.WSOL_MINT,       // Input: Native SOL
                CONFIG.TOKENS.SOL.WETH_MINT,  // Output: WETH (on Sol)
                amountToSwapLamports
            );
            
            await solService.executeSwap(quote);
            console.log("Excess SOL sold for WETH.");
            res = true;
        } catch (e) {
            console.error("Failed to sell excess SOL:", e);
        }
    }

    // ---------------------------------------------------------
    // 2. Bridge ASSDAQ (Solana <-> Ethereum)
    // ---------------------------------------------------------
    try {
        if (assEth < CONFIG.PERCENT_FOR_REBALANCE * totalAssdaq) {
            // Case: Not enough ASSDAQ on ETH -> Bridge from SOL
                console.log(`Rebalance: Low ASSDAQ on ETH (${assEth}) < (${CONFIG.PERCENT_FOR_REBALANCE * totalAssdaq}). Bridging Sol -> Eth...`);
            
            const amountToBridge = Math.floor((CONFIG.TARGET_PERCENT * totalAssdaq) - assEth);
            if (amountToBridge > 0) {
                await bridgeAssdaqSolToEth(amountToBridge, wh);
                res = true;
            }

        } else if (assSol < CONFIG.PERCENT_FOR_REBALANCE * totalAssdaq) {
            // Case: Not enough ASSDAQ on SOL -> Bridge from ETH
            console.log(`Rebalance: Low ASSDAQ on SOL (${assSol}) < (${CONFIG.PERCENT_FOR_REBALANCE * totalAssdaq}). Bridging Eth -> Sol...`);
            
            const amountToBridge = Math.floor((CONFIG.TARGET_PERCENT * totalAssdaq) - assSol);
            if (amountToBridge > 0) {
                await bridgeAssdaqEthToSol(amountToBridge, wh);
                res = true;
            }
        }
    } catch (e) {
        console.error("ASSDAQ Bridging failed:", e);
    }

    // ---------------------------------------------------------
    // 3. Bridge ETH (Solana WETH <-> Ethereum Native ETH)
    // ---------------------------------------------------------
    try {
        if (ethEth < CONFIG.PERCENT_FOR_REBALANCE * totalEth) {
            // Case: Low Native ETH -> Bridge WETH from SOL
            console.log(`Rebalance: Low ETH on ETH (${ethEth}) < (${totalEth * CONFIG.PERCENT_FOR_REBALANCE}). Bridging Sol -> Eth...`);
            
            // Original script used String() for ETH amounts
            const amountToBridge = String((CONFIG.TARGET_PERCENT * totalEth) - ethEth);
            
            // Safety check to ensure we aren't sending negative or tiny amounts
            if (Number(amountToBridge) > 0.0001) { 
                await bridgeWethSolToEth(amountToBridge, wh);
                res = true;
            } else {
                console.error(`${Number(amountToBridge)} is too low to bridge. Skipping.`);
            }

        } else if (wethSol < CONFIG.PERCENT_FOR_REBALANCE * totalEth) {
            // Case: Low WETH on SOL -> Bridge Native ETH from ETH
            console.log(`Rebalance: Low WETH on Sol (${wethSol}) < (${totalEth * CONFIG.PERCENT_FOR_REBALANCE}). Bridging Eth -> Sol...`);
            
            const amountToBridge = String((CONFIG.TARGET_PERCENT * totalEth) - wethSol);
            
            if (Number(amountToBridge) > 0.0001) {
                await bridgeEthToWethSol(amountToBridge, wh);
                res = true;
            } else {
                console.error(`${Number(amountToBridge)} is too low to bridge. Skipping.`);
            }
        }
    } catch (e) {
        console.error("ETH Bridging failed:", e);
    }
    return res;
}

async function main() {
    const wh = await wormhole('Mainnet', [solana, evm], {
        chains: {
            Ethereum: { "rpc": CONFIG.RPC.ETHEREUM },
            Solana: { "rpc": CONFIG.RPC.HELIUS }
        }
    });

    let i = 0;
    while (true) {
        try {
            await performArbitrageCheck(i++, wh);
        } catch (e) {
            console.error(`Loop Error at iteration ${i}: `, e);
        }
        console.log(`Sleeping ${CONFIG.SLEEP_BETWEEN_ITERATIONS_MS / 1000} seconds... `);
        await sleep(CONFIG.SLEEP_BETWEEN_ITERATIONS_MS);
    }
}

main().catch(console.error);