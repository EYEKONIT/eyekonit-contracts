import assert from 'node:assert/strict';
import {waitForEvolutionReceipt} from './evolution-receipt';
import type {Provider} from 'ethers';
async function main(){
 const receipt={hash:'saved',status:1,blockNumber:10,blockHash:'canonical'};
 const provider={getTransactionReceipt:async(hash:string)=>{assert.equal(hash,'saved');return receipt;},getBlock:async(number:number)=>{assert.equal(number,10);return {hash:'canonical'};}} as unknown as Pick<Provider,'getTransactionReceipt'|'getBlock'>;
 assert.equal(await waitForEvolutionReceipt(provider,'saved'),receipt);
 await assert.rejects(waitForEvolutionReceipt({...provider,getBlock:async()=>({hash:'fork'} as any)},'saved'));
 await assert.rejects(waitForEvolutionReceipt(provider,'saved',0));
 console.log('Recorded receipt recovery verifies the exact hash and canonical block without signing');
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
