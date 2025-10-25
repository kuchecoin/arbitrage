import { ethers } from "ethers";
import * as dotenv from 'dotenv';
dotenv.config();


// --- Setup ---
const provider = new ethers.JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/BdKRFPCNpdIYGuvM6ltQV");
const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY || '', provider);

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
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)"
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

async function simpleSwapEthForAssdaq() {
  const tokenIn = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
  const tokenOut = "0xF4F53989d770458B659f8D094b8E31415F68A4Cf"; // ASSDAQ
  const amountIn = ethers.parseEther("0.0005"); // ethers.parseUnits("0.0005", 18); //
  const to = await wallet.getAddress();

  // --- Get reserves and compute expected out ---
  const { reserveIn, reserveOut, pairAddress } = await getPairReserves(tokenIn, tokenOut);
  const expectedAmountOut = getAmountOut(amountIn, reserveIn, reserveOut);

  console.log("Pair:", pairAddress);
  console.log("Reserves In:", reserveIn.toString());
  console.log("Reserves Out:", reserveOut.toString());
  console.log("Expected amount out:", ethers.formatEther(expectedAmountOut));

  // --- Create token + router contracts ---
  const tokenInContract = new ethers.Contract(tokenIn, erc20Abi, wallet);
  const tokenOutContract = new ethers.Contract(tokenOut, erc20Abi, wallet);
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, wallet);

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

simpleSwapEthForAssdaq().catch(console.error);
