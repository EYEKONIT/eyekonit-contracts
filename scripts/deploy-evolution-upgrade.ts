import {artifacts,ethers} from 'hardhat';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const json=(value:unknown)=>JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item,2);
async function main(){
 assert.equal(process.env.EXECUTE_EVOLUTION_UPGRADE,'yes','Explicit execution flag required');
 const plan=JSON.parse(fs.readFileSync('deployments/polygon-evolution-v3-plan.json','utf8'));
 const [owner]=await ethers.getSigners();assert.equal((await owner.getAddress()).toLowerCase(),plan.owner.toLowerCase());assert.equal(Number((await ethers.provider.getNetwork()).chainId),137);
 const network=await fetch('https://api.eyekonit.com/api/health/blockchain-network').then(response=>response.json());
 assert.equal(network.maintenance,true,'Enable and verify platform blockchain maintenance first');assert.equal(network.chainId,137);assert.equal(network.contracts.identityNft.toLowerCase(),plan.legacy.IdentityNFT.toLowerCase());
 const oldNFT=new ethers.Contract(plan.legacy.IdentityNFT,(await artifacts.readArtifact('IdentityNFTV2')).abi,owner),oldTimeline=new ethers.Contract(plan.legacy.Timeline,(await artifacts.readArtifact('TimelineV2')).abi,owner);
 const nftArtifact=await artifacts.readArtifact('IdentityNFTV3'),timelineArtifact=await artifacts.readArtifact('TimelineV3');assert.equal(ethers.keccak256(nftArtifact.bytecode),plan.bytecodeHashes.IdentityNFT);assert.equal(ethers.keccak256(timelineArtifact.bytecode),plan.bytecodeHashes.Timeline);
 const statePath='deployments/polygon-evolution-v3-staged.json';
 const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{chainId:137,owner:plan.owner,legacy:plan.legacy,contracts:{},steps:[],status:'preparing'};
 const persist=()=>fs.writeFileSync(statePath,json(state)+'\n');
 if(state.steps.length===0)assert.equal(await ethers.provider.getTransactionCount(plan.owner,'pending'),plan.nonce,'Owner nonce changed; regenerate the unsigned plan');
 assert.equal(Number(await oldNFT.getTotalIdentities()),plan.identityCount);assert.equal(Number(await oldNFT.getTotalTokens()),plan.tokenCount);assert.equal(Number(await oldTimeline.getTotalTimelines()),plan.timelineCount);
 for(const definition of plan.definitions)assert.equal(JSON.stringify((await oldNFT.getIdentity(definition.id)).toArray(),(_key,item)=>typeof item==='bigint'?item.toString():item),JSON.stringify(definition.fields),'Legacy definition changed; stop and review');
 const balance=await ethers.provider.getBalance(plan.owner);if(state.steps.length===0)assert.ok(balance>ethers.parseEther(plan.ownerGasBudgetPOL),'Owner balance no longer covers the reviewed gas budget');
 const fees=await ethers.provider.getFeeData(),cap=BigInt(plan.maxFeePerGasWei);assert.ok((fees.maxFeePerGas||fees.gasPrice||0n)<=cap,'Gas fee exceeds the reviewed cap; regenerate the plan');
 const gas={maxFeePerGas:cap,maxPriorityFeePerGas:fees.maxPriorityFeePerGas || 30000000000n};assert.ok(gas.maxPriorityFeePerGas<=cap);
 async function step(label:string,send:()=>Promise<any>){
  const prior=state.steps.find((entry:any)=>entry.label===label);if(prior){assert.equal((await ethers.provider.getTransactionReceipt(prior.hash))?.status,1);return prior;}
  const transaction=await send(),receipt=await transaction.wait(1);assert.equal(receipt.status,1);const entry={label,hash:receipt.hash,blockNumber:receipt.blockNumber,address:receipt.contractAddress,gasUsed:receipt.gasUsed.toString(),costPOL:ethers.formatEther(receipt.gasUsed*receipt.gasPrice)};state.steps.push(entry);persist();console.log(JSON.stringify(entry));return entry;
 }
 async function deploy(name:string,label:string,args:string[]){const prior=state.steps.find((entry:any)=>entry.label===label);if(prior)return ethers.getContractAt(name,prior.address,owner);const factory=await ethers.getContractFactory(name,owner),contract=await factory.deploy(...args,gas);await step(label,async()=>contract.deploymentTransaction());return new ethers.Contract(await contract.getAddress(),contract.interface,owner);}
 const nft=await deploy('IdentityNFTV3','Deploy immutable evolution NFT registry',[plan.legacy.AccessControl,plan.legacy.IdentityNFT]);state.contracts.IdentityNFT=await nft.getAddress();assert.equal(state.contracts.IdentityNFT.toLowerCase(),plan.expected.IdentityNFT.toLowerCase());persist();
 await step('Keep legacy secondary royalty configuration readable',()=>nft.setPaymentSplitter(plan.legacy.PaymentSplitter,gas));
 const splitter=await deploy('PaymentSplitterV2','Deploy mandatory 80/20 splitter',[state.contracts.IdentityNFT]);state.contracts.PaymentSplitter=await splitter.getAddress();assert.equal(state.contracts.PaymentSplitter.toLowerCase(),plan.expected.PaymentSplitter.toLowerCase());assert.equal((await splitter.PLATFORM_WALLET()).toLowerCase(),'0x497574ee15579f9f6836d472eac236f85be4478d');persist();
 await step('Configure the new 80/20 splitter',()=>nft.setPaymentSplitter(state.contracts.PaymentSplitter,gas));
 const timeline=await deploy('TimelineV3','Deploy immutable timeline registry',[plan.legacy.AccessControl,plan.legacy.Timeline]);state.contracts.Timeline=await timeline.getAddress();assert.equal(state.contracts.Timeline.toLowerCase(),plan.expected.Timeline.toLowerCase());persist();
 await step('Configure NFT timeline callbacks',()=>nft.setTimelineContract(state.contracts.Timeline,gas));await step('Configure timeline NFT ownership checks',()=>timeline.setIdentityContract(state.contracts.IdentityNFT,gas));
 for(const definition of plan.definitions)await step(`Preserve identity ${definition.id}`,()=>nft.importLegacyIdentity(definition.id,gas));
 for(const original of plan.timelines)await step(`Preserve timeline ${original.id}`,()=>timeline.importLegacyTimeline(original.id,gas));
 await step('Freeze legacy chapter claims',()=>oldNFT.setTimelineContract(state.contracts.Timeline,gas));
 for(const original of plan.progress)await step(`Preserve timeline ${original.id} progress for ${original.user}`,()=>timeline.importLegacyProgress(original.id,original.user,gas));
 assert.equal(await nft.migrationComplete(),false);assert.equal(await timeline.migrationComplete(),false);assert.equal((await splitter.identityContract()).toLowerCase(),state.contracts.IdentityNFT.toLowerCase());
 state.status='awaiting_holder_transfers';state.tokens=plan.tokens;state.progress=plan.progress;persist();console.log(JSON.stringify({status:state.status,contracts:state.contracts,tokensToMigrate:plan.tokenCount,ownerBalancePOL:ethers.formatEther(await ethers.provider.getBalance(plan.owner))}));
}
main().catch(error=>{console.error(error.code||String(error.message).replace(/https?:\/\/\S+/g,'[endpoint]'));process.exitCode=1});
