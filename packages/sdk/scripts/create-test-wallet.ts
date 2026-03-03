import { ethers } from 'ethers';

const wallet = ethers.Wallet.createRandom();

console.log('=== New Test Wallet ===');
console.log(`Address:     ${wallet.address}`);
console.log(`Private Key: ${wallet.privateKey}`);
console.log('');
console.log('Add to your .env:');
console.log(`OPENGARDEN_TEST_PRIVATE_KEY=${wallet.privateKey}`);
console.log('');
console.log('Fund with Optimism Sepolia ETH:');
console.log(`  https://www.alchemy.com/faucets/optimism-sepolia`);
console.log(`  https://faucet.quicknode.com/optimism/sepolia`);
