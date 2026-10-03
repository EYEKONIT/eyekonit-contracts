import {ethers} from 'hardhat';
import assert from 'node:assert/strict';
import fs from 'node:fs';
async function main(){
 assert.equal(process.env.EXECUTE_EVOLUTION_ROLLBACK,'yes','Explicit rollback flag required');
 const plan=JSON.parse(fs.readFileSync('deployments/polygon-evolution-v3-plan.json','utf8')),state=JSON.parse(fs.readFileSync('deployments/polygon-evolution-v3-staged.json','utf8'));
 const [owner]=await ethers.getSigners();assert.equal((await owner.getAddress()).toLowerCase(),plan.owner.toLowerCase());assert.equal(Number((await ethers.provider.getNetwork()).chainId),137);
 const network=await fetch('https://api.eyekonit.com/api/health/blockchain-network').then(response=>response.json());assert.equal(network.maintenance,true);assert.equal(network.contracts.identityNft.toLowerCase(),plan.legacy.IdentityNFT.toLowerCase());
 const oldNFT=await ethers.getContractAt('IdentityNFTV2',plan.legacy.IdentityNFT,owner),nft=await ethers.getContractAt('IdentityNFTV3',state.contracts.IdentityNFT,owner);
 assert.equal(await nft.migrationComplete(),false,'Finalized ownership cannot be rolled back');assert.equal(await nft.migratedTokenCount(),0n,'Every holder must recover their original before rollback');
 for(const token of plan.tokens)assert.equal((await oldNFT.ownerOf(token.tokenId)).toLowerCase(),token.holder.toLowerCase(),'An original has not been recovered');
 if((await oldNFT.timeline()).toLowerCase()!==plan.legacy.Timeline.toLowerCase()){const tx=await oldNFT.setTimelineContract(plan.legacy.Timeline),receipt=await tx.wait();assert.equal(receipt?.status,1);state.rollback={hash:tx.hash,blockNumber:receipt!.blockNumber};}
 assert.equal((await oldNFT.timeline()).toLowerCase(),plan.legacy.Timeline.toLowerCase());state.status='legacy_restored_maintenance_active';fs.writeFileSync('deployments/polygon-evolution-v3-staged.json',JSON.stringify(state,null,2)+'\n');console.log(JSON.stringify({status:state.status,rollback:state.rollback}));
}
main().catch(error=>{console.error(String(error.message||error.code).replace(/https?:\/\/\S+/g,'[endpoint]'));process.exitCode=1});
