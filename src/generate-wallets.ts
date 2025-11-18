import { Keypair } from "@solana/web3.js";
import { Wallet } from "ethers";
import * as bs58 from 'bs58';

/**
 * Generates a new Solana wallet (Keypair).
 */
function generateSolanaWallet() {
  const solanaKeypair = Keypair.generate();
  
  const publicKey = solanaKeypair.publicKey.toBase58();
  
  // 1. Raw Uint8Array (the native private key)
  const privateKeyArray = solanaKeypair.secretKey;
  
  // 2. Base58 encoded string (Often used for Phantom/CLI code, or storage)
  const privateKeyBase58 = bs58.encode(privateKeyArray);
  
  // 3. Comma-separated string for printing the array (Matches the raw Uint8Array structure)
  const privateKeyArrayString = `[${Array.from(privateKeyArray).join(', ')}]`;
  
  return {
    wallet: publicKey,
    privateKeyArray: privateKeyArrayString, // Your Custom Code Array Input
    privateKeyBase58: privateKeyBase58,     // Phantom/CLI Use Case
  };
}

/**
 * Generates a new Ethereum wallet.
 */
function generateEthereumWallet() {
  const ethWallet = Wallet.createRandom();
  
  const address = ethWallet.address;
  const privateKey = ethWallet.privateKey; // Hex String
  
  return {
    wallet: address,
    privateKey: privateKey,
  };
}

/**
 * Main function to generate and print both wallets.
 */
function main() {
  console.log("--- Wallet Generation Results ---");
  
  // --- Solana Wallet ---
  const solanaWallet = generateSolanaWallet();
  console.log("\n## Solana Wallet Address:");
  console.log(solanaWallet.wallet);
  
  console.log("\n### Solana Private Key (Base58 String - Phantom use):");
  console.log(solanaWallet.privateKeyBase58);
  
  console.log("\n### Solana Private Key (Array Input matches Uint8Array structure)");
  console.log(solanaWallet.privateKeyArray);
  
  // --- Ethereum Wallet ---
  const ethWallet = generateEthereumWallet();
  console.log("\n---\n");
  console.log("## Ethereum Wallet (EVM):");
  console.log(ethWallet.wallet);
  console.log(`Private Key (Hex String):\n${ethWallet.privateKey}`);
}

main();
