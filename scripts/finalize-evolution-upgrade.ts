import {artifacts,ethers} from 'hardhat';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const json=(value:unknown)=>JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item,2);
async function main(){
 assert.equal(process.env.EXECUTE_EVOLUTION_FINALIZATION,'yes','Explicit finalization flag required');
 const plan=JSON.parse(fs.readFileSync('deployments/polygon-evolution-v3-plan.json','utf8')),statePath='deployments/polygon-evolution-v3-staged.json',state=JSON.parse(fs.readFileSync(statePath,'utf8'));
 const [owner]=await ethers.getSigners();assert.equal((await owner.getAddress()).toLowerCase(),plan.owner.toLowerCase());assert.equal(Number((await ethers.provider.getNetwork()).chainId),137);assert.ok(!state.pending,'Resolve the recorded deployment transaction first');
 const network=await fetch('https://api.eyekonit.com/api/health/blockchain-network').then(response=>response.json());assert.equal(network.maintenance,true);assert.equal(network.contracts.identityNft.toLowerCase(),plan.legacy.IdentityNFT.toLowerCase());
 const nft=await ethers.getContractAt('IdentityNFTV3',state.contracts.IdentityNFT,owner),timeline=await ethers.getContractAt('TimelineV3',state.contracts.Timeline,owner),oldNFT=await ethers.getContractAt('IdentityNFTV2',plan.legacy.IdentityNFT,owner);
 assert.equal((await nft.owner()).toLowerCase(),plan.owner.toLowerCase());assert.equal((await timeline.owner()).toLowerCase(),plan.owner.toLowerCase());assert.equal((await nft.legacyIdentity()).toLowerCase(),plan.legacy.IdentityNFT.toLowerCase());assert.equal((await timeline.legacyTimeline()).toLowerCase(),plan.legacy.Timeline.toLowerCase());
 assert.equal((await nft.timeline()).toLowerCase(),state.contracts.Timeline.toLowerCase());assert.equal((await timeline.identityContract()).toLowerCase(),state.contracts.IdentityNFT.toLowerCase());assert.equal((await nft.paymentSplitter()).toLowerCase(),state.contracts.PaymentSplitter.toLowerCase());
 for(const token of plan.tokens){assert.equal((await oldNFT.ownerOf(token.tokenId)).toLowerCase(),state.contracts.IdentityNFT.toLowerCase(),'An original is not escrowed');assert.equal((await nft.ownerOf(token.tokenId)).toLowerCase(),token.holder.toLowerCase(),'Replacement owner changed');assert.equal((await nft.tokenToIdentity(token.tokenId)).toString(),token.identityId);assert.equal(await nft.tokenURI(token.tokenId),token.uri);}
 for(const definition of plan.definitions){const expected=definition.fields;const actual=JSON.parse(json(Array.from(await nft.getIdentity(definition.id))));assert.deepEqual(actual,expected,'An identity definition or supply differs');}
 for(const original of plan.timelines){assert.deepEqual(JSON.parse(json(Array.from(await timeline.getTimeline(original.id)))),original.fields);for(let chapter=1;chapter<=original.chapters.length;chapter++)assert.deepEqual(JSON.parse(json(Array.from(await timeline.getChapter(original.id,chapter)))),original.chapters[chapter-1]);}
 for(const original of plan.progress){const [completed,count,complete]=await timeline.getUserProgress(original.id,original.user);assert.deepEqual(completed.map(String),original.completed);assert.equal(count.toString(),original.count);assert.equal(complete,original.isComplete);}
 const complete=[await nft.migrationComplete(),await timeline.migrationComplete()];
 const fees=await ethers.provider.getFeeData(),cap=BigInt(plan.maxFeePerGasWei);assert.ok((fees.maxFeePerGas||fees.gasPrice||0n)<=cap,'Current fees exceed the reviewed cap');const gas={maxFeePerGas:cap,maxPriorityFeePerGas:fees.maxPriorityFeePerGas||30000000000n};
 // Simulate BOTH irreversible operations before submitting either.
 const estimates:bigint[]=[];for(const [index,contract] of [nft,timeline].entries())if(!complete[index]) {await contract.finalizeMigration.staticCall();estimates.push(await contract.finalizeMigration.estimateGas());}
 assert.ok(await ethers.provider.getBalance(plan.owner)>estimates.reduce((sum,value)=>sum+value,0n)*12n/10n*cap,'Owner funding does not cover both finalizations');
 state.finalizations ||= [];
 for(const [index,contract] of [nft,timeline].entries()) {
   if(complete[index]) continue;
   const label=index===0?'Finalize verified NFT ownership':'Finalize verified timeline progress';
   let hash:string;
   if(state.finalizationPending){assert.equal(state.finalizationPending.label,label);hash=state.finalizationPending.hash;}
   else {const tx=await contract.finalizeMigration(gas);hash=tx.hash;state.finalizationPending={label,hash};fs.writeFileSync(statePath,json(state)+'\n');}
   const receipt=await ethers.provider.waitForTransaction(hash,1,120000);assert.equal(receipt?.status,1,'Keep the recorded hash and resolve finalization before continuing');state.finalizations.push({label,hash,blockNumber:receipt!.blockNumber});delete state.finalizationPending;fs.writeFileSync(statePath,json(state)+'\n');console.log(JSON.stringify({label,hash,blockNumber:receipt!.blockNumber}));
 }
 assert.equal(await nft.migrationComplete(),true);assert.equal(await timeline.migrationComplete(),true);state.status='finalized_awaiting_website_cutover';fs.writeFileSync(statePath,json(state)+'\n');
 console.log(JSON.stringify({status:state.status,contracts:state.contracts,legacyPaymentSplitter:plan.legacy.PaymentSplitter,identityProtocolVersion:3}));
}
main().catch(error=>{console.error(String(error.message||error.code).replace(/https?:\/\/\S+/g,'[endpoint]'));process.exitCode=1});
