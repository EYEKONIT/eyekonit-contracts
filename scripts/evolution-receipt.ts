import assert from 'node:assert/strict';
import type {Provider,TransactionReceipt} from 'ethers';

/** Hardhat's provider does not implement waitForTransaction. Resume a recorded
 * hash using supported receipt/block reads, without submitting another write. */
export async function waitForEvolutionReceipt(provider:Pick<Provider,'getTransactionReceipt'|'getBlock'>,hash:string,timeoutMs=120000):Promise<TransactionReceipt> {
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const receipt=await provider.getTransactionReceipt(hash);
    if(receipt){const block=await provider.getBlock(receipt.blockNumber);assert.equal(block?.hash,receipt.blockHash,'Recorded receipt is not canonical');return receipt;}
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error('Recorded transaction is still pending; resume using the same hash');
}
