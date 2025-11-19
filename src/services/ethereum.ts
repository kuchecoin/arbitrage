import { ethers } from "ethers";
import { CONFIG, ABIS } from "../config";

export class EthereumService {
    private provider: ethers.JsonRpcProvider;
    private wallet: ethers.Wallet;
    private router: ethers.Contract;

    constructor() {
        this.provider = new ethers.JsonRpcProvider(CONFIG.RPC.ETHEREUM);
        this.wallet = new ethers.Wallet(CONFIG.WALLETS.ETH_PRIVATE_KEY || '', this.provider);
        this.router = new ethers.Contract(CONFIG.UNISWAP.V2_ROUTER, ABIS.V2_ROUTER, this.wallet);
    }

    get address() { return this.wallet.address; }
    get signer() { return this.wallet; }

    async getEthBalance(): Promise<number> {
        const balance = await this.provider.getBalance(this.address);
        return Number(ethers.formatEther(balance));
    }

    async getTokenBalance(tokenAddress: string): Promise<number> {
        const contract = new ethers.Contract(tokenAddress, ABIS.ERC20, this.provider);
        const balance = await contract.balanceOf(this.address);
        const decimals = await contract.decimals();
        return Number(ethers.formatUnits(balance, decimals));
    }

    // TODO ADD DOC and explain the function
    async getPairReserves(tokenIn: string) {
        const pair = new ethers.Contract(CONFIG.TOKENS.ETH.ASSDAQ_ETH_PAIR_ADDRESS, ABIS.UNISWAP_PAIR, this.provider);
        const [reserve0, reserve1] = await pair.getReserves();
        const token0 = await pair.token0();
        
        return (tokenIn.toLowerCase() === token0.toLowerCase()) 
            ? { reserveIn: reserve0, reserveOut: reserve1 } 
            : { reserveIn: reserve1, reserveOut: reserve0 };
    }

    getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
        const amountInWithFee = amountIn * 997n;
        const numerator = amountInWithFee * reserveOut;
        const denominator = reserveIn * 1000n + amountInWithFee;
        return numerator / denominator;
    }

    // Unified Swap Function
    async executeSwap(tokenIn: string, tokenOut: string, amountInStr: string, isNativeIn: boolean = false) {
        const amountIn = ethers.parseEther(amountInStr); // Assuming 18 decimals for simplicity, adjust if dynamic (both assdaq and eth have 18 decimals on eth)
        const to = this.address;
        
        // 1. Calc Expected Out
        const { reserveIn, reserveOut } = await this.getPairReserves(tokenIn);
        const expectedAmountOut = this.getAmountOut(amountIn, reserveIn, reserveOut);
        const minAmountOut = expectedAmountOut * 99n / 100n; // 1% slippage
        
        const deadline = Math.floor(Date.now() / 1000) + 600;
        const path = [tokenIn, tokenOut];

        console.log(`ETH: Swapping ${amountInStr} of ${tokenIn} for ${tokenOut}`);

        // 2. Approve if Token In (not ETH)
        if (!isNativeIn) {
            const tokenContract = new ethers.Contract(tokenIn, ABIS.ERC20, this.wallet);
            const allowance = await tokenContract.allowance(to, CONFIG.UNISWAP.V2_ROUTER);
            if (allowance < amountIn) {
                console.log("Approving token...");
                const tx = await tokenContract.approve(CONFIG.UNISWAP.V2_ROUTER, amountIn);
                await tx.wait();
            }
        }

        // 3. Swap
        let tx;
        if (isNativeIn) {
            tx = await this.router.swapExactETHForTokens(minAmountOut, path, to, deadline, { value: amountIn });
        } else {
            tx = await this.router.swapExactTokensForETH(amountIn, minAmountOut, path, to, deadline);
        }

        console.log("Tx hash:", tx.hash);
        const receipt = await tx.wait();
        console.log("Swap confirmed block:", receipt.blockNumber);
    }
}
