import {artifacts,ethers} from 'hardhat';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {assertFeeCap} from './evolution-fees';
import {waitForEvolutionReceipt} from './evolution-receipt';
const json=(value:unknown)=>JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item,2);
async function main(){
 assert.equal(process.env.EXECUTE_PERSONAL_TIMELINE_UPGRADE,'yes','Explicit execution flag required');
 const statePath='deployments/polygon-evolution-v3-staged.json',state=JSON.parse(fs.readFileSync(statePath,'utf8')),plan=JSON.parse(fs.readFileSync('deployments/polygon-evolution-v3-plan.json','utf8'));
 const [owner]=await ethers.getSigners();assert.equal((await owner.getAddress()).toLowerCase(),plan.owner.toLowerCase());assert.equal(Number((await ethers.provider.getNetwork()).chainId),137);assert.ok(!state.pending);
 const network=await fetch('https://api.eyekonit.com/api/health/blockchain-network').then(response=>response.json());assert.equal(network.maintenance,true);assert.equal(network.contracts.identityNft.toLowerCase(),plan.legacy.IdentityNFT.toLowerCase());
 const nft=await ethers.getContractAt('IdentityNFTV3',state.contracts.IdentityNFT,owner),oldNFT=await ethers.getContractAt('IdentityNFTV2',plan.legacy.IdentityNFT,owner);assert.equal(await nft.migrationComplete(),false,'Finish the personal timeline update before finalizing NFT ownership');
 const artifact=await artifacts.readArtifact('TimelineV4'),cap=BigInt(plan.maxFeePerGasWei),priority=BigInt(plan.maxPriorityFeePerGasWei),gas={maxFeePerGas:cap,maxPriorityFeePerGas:priority};
 const persist=()=>fs.writeFileSync(statePath,json(state)+'\n');
 if(!state.personalTimelineUpgrade){
   const nonce=await ethers.provider.getTransactionCount(plan.owner,'pending'),factory=await ethers.getContractFactory('TimelineV4',owner),tx=await factory.getDeployTransaction(plan.legacy.AccessControl,plan.legacy.Timeline);
   const deploymentGas=await ethers.provider.estimateGas({...tx,from:plan.owner}),units=deploymentGas*12n/10n+BigInt(plan.timelineCount)*1000000n+BigInt(plan.progress.length)*600000n+500000n;
   const cost=units*cap,priorCost=state.steps.reduce((sum:bigint,entry:any)=>sum+ethers.parseEther(entry.costPOL),0n);
   assert.ok(priorCost+cost<=ethers.parseEther(plan.ownerGasBudgetPOL),'Supplemental update exceeds the original reviewed total budget');assert.ok(await ethers.provider.getBalance(plan.owner)>cost+ethers.parseEther('1'),'Preserve the owner reserve before the supplemental update');
   state.personalTimelineUpgrade={nonce,expected:ethers.getCreateAddress({from:plan.owner,nonce}),previousTimeline:state.contracts.Timeline,bytecodeHash:ethers.keccak256(artifact.bytecode),gasUnits:units.toString(),budgetPOL:ethers.formatEther(cost),steps:[]};persist();
 }
 const upgrade=state.personalTimelineUpgrade;assert.equal(ethers.keccak256(artifact.bytecode),upgrade.bytecodeHash);
 async function step(label:string,send:()=>Promise<any>){
   const previous=upgrade.steps.find((entry:any)=>entry.label===label);if(previous){assert.equal((await ethers.provider.getTransactionReceipt(previous.hash))?.status,1);return previous;}
   let hash:string;
   if(upgrade.pending){assert.equal(upgrade.pending.label,label);hash=upgrade.pending.hash;}
   else {assertFeeCap((await ethers.provider.getBlock('latest'))?.baseFeePerGas,priority,cap);const used=upgrade.steps.reduce((sum:bigint,entry:any)=>sum+BigInt(entry.gasUsed),0n),remaining=BigInt(upgrade.gasUnits)>used?BigInt(upgrade.gasUnits)-used:0n;assert.ok(await ethers.provider.getBalance(plan.owner)>=remaining*cap+ethers.parseEther('1'));const tx=await send();hash=tx.hash;upgrade.pending={label,hash};persist();console.log(JSON.stringify({label,hash,status:'submitted'}));}
   const receipt=await waitForEvolutionReceipt(ethers.provider,hash);assert.equal(receipt.status,1);const result={label,hash,address:receipt.contractAddress,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),costPOL:ethers.formatEther(receipt.gasUsed*receipt.gasPrice)};upgrade.steps.push(result);delete upgrade.pending;persist();console.log(JSON.stringify(result));return result;
 }
 const deployment=await step('Deploy personal and organization timeline registry',async()=>{assert.equal(await ethers.provider.getTransactionCount(plan.owner,'pending'),upgrade.nonce);const contract=await(await ethers.getContractFactory('TimelineV4',owner)).deploy(plan.legacy.AccessControl,plan.legacy.Timeline,gas);return contract.deploymentTransaction();});
 assert.equal(deployment.address.toLowerCase(),upgrade.expected.toLowerCase());const timeline=await ethers.getContractAt('TimelineV4',deployment.address,owner);
 await step('Configure personal timeline NFT ownership checks',()=>timeline.setIdentityContract(state.contracts.IdentityNFT,gas));
 for(const original of plan.timelines)await step(`Preserve timeline ${original.id} in personal-capable registry`,()=>timeline.importLegacyTimeline(original.id,gas));
 await step('Route new NFT callbacks to personal-capable timelines',()=>nft.setTimelineContract(deployment.address,gas));
 await step('Freeze legacy callbacks through personal-capable timelines',()=>oldNFT.setTimelineContract(deployment.address,gas));
 for(const original of plan.progress)await step(`Preserve personal-capable timeline ${original.id} progress for ${original.user}`,()=>timeline.importLegacyProgress(original.id,original.user,gas));
 assert.equal((await nft.timeline()).toLowerCase(),deployment.address.toLowerCase());assert.equal((await oldNFT.timeline()).toLowerCase(),deployment.address.toLowerCase());assert.equal(await timeline.migrationComplete(),false);
 state.contracts.Timeline=deployment.address;state.timelineArtifact='TimelineV4';state.status='awaiting_holder_transfers';upgrade.status='complete';persist();console.log(JSON.stringify({status:state.status,contracts:state.contracts,personalTimelineSupport:true,ownerBalancePOL:ethers.formatEther(await ethers.provider.getBalance(plan.owner))}));
}
main().catch(error=>{console.error(String(error.message||error.code).replace(/https?:\/\/\S+/g,'[endpoint]'));process.exitCode=1});
