import {artifacts,ethers} from 'hardhat';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fundedFeeCap} from './evolution-fees';
const encode=(value:unknown)=>JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item);
async function main(){
 const current=await fetch('https://api.eyekonit.com/api/health/blockchain-network').then(response=>response.json());
 assert.equal(current.chainId,137);assert.equal(current.contracts.identityNft.toLowerCase(),'0xdfeb1cbaaf0fdf4b909a5a12f03db03b5f18ef15');
 const oldSource=new ethers.Contract(current.contracts.identityNft,(await artifacts.readArtifact('IdentityNFTV3')).abi,ethers.provider);
 const contracts={AccessControl:await oldSource.accessControl(),IdentityNFT:current.contracts.identityNft,Timeline:current.contracts.timeline,PaymentSplitter:current.contracts.paymentSplitter};
 const owner='0x988d0D4f9E58913440B52B2dAa0c472E7CB7f64D';
 assert.equal(Number((await ethers.provider.getNetwork()).chainId),137);
 const oldNFT=new ethers.Contract(contracts.IdentityNFT,(await artifacts.readArtifact('IdentityNFTV3')).abi,ethers.provider);
 const oldTimeline=new ethers.Contract(contracts.Timeline,(await artifacts.readArtifact('TimelineV4')).abi,ethers.provider);
 assert.equal((await oldNFT.owner()).toLowerCase(),owner.toLowerCase());assert.equal((await oldTimeline.owner()).toLowerCase(),owner.toLowerCase());
 assert.equal((await oldNFT.timeline()).toLowerCase(),contracts.Timeline.toLowerCase());
 const identityCount=Number(await oldNFT.getTotalIdentities()),tokenCount=Number(await oldNFT.getTotalTokens()),timelineCount=Number(await oldTimeline.getTotalTimelines());
 const definitions=[],tokens=[],timelines=[],progress=[],users=new Set<string>();
 for(let id=1;id<=identityCount;id++){const item=await oldNFT.getIdentity(id);definitions.push({id,fields:JSON.parse(encode(item.toArray())),timelineId:(await oldNFT.identityToTimeline(id)).toString()});users.add(item.creator.toLowerCase());}
 for(let tokenId=1;tokenId<=tokenCount;tokenId++){const holder=await oldNFT.ownerOf(tokenId);users.add(holder.toLowerCase());tokens.push({tokenId,holder,identityId:(await oldNFT.tokenToIdentity(tokenId)).toString(),uri:await oldNFT.tokenURI(tokenId)});}
 for(let id=1;id<=timelineCount;id++){
  const item=await oldTimeline.getTimeline(id),chapters=[];for(let chapter=1;chapter<=Number(item.totalChapters);chapter++)chapters.push(JSON.parse(encode((await oldTimeline.getChapter(id,chapter)).toArray())));
  timelines.push({id,fields:JSON.parse(encode(item.toArray())),chapters});
  let found=0;for(const user of users){const [completed,count,isComplete]=await oldTimeline.getUserProgress(id,user);if(count>0n){found++;const stored=await oldTimeline.userProgress(id,user);progress.push({id,user,completed:completed.map((value:bigint)=>value.toString()),count:count.toString(),lastCompletedAt:stored.lastCompletedAt.toString(),isComplete});}}
  assert.equal(found,Number(await oldTimeline.timelineHolderCount(id)),`Timeline ${id}: enumerate missing historical holders before migration`);
 }
 const nonce=await ethers.provider.getTransactionCount(owner,'pending'),nftAddress=ethers.getCreateAddress({from:owner,nonce}),splitterAddress=ethers.getCreateAddress({from:owner,nonce:nonce+2}),timelineAddress=ethers.getCreateAddress({from:owner,nonce:nonce+4});
 const nftArtifact=await artifacts.readArtifact('IdentityNFTV4'),timelineArtifact=await artifacts.readArtifact('TimelineV5');
 const nftDeployment=await new ethers.ContractFactory(nftArtifact.abi,nftArtifact.bytecode).getDeployTransaction(contracts.AccessControl,contracts.IdentityNFT);
 const timelineDeployment=await new ethers.ContractFactory(timelineArtifact.abi,timelineArtifact.bytecode).getDeployTransaction(contracts.AccessControl,contracts.Timeline);
 const nftGas=await ethers.provider.estimateGas({...nftDeployment,from:owner}),timelineGas=await ethers.provider.estimateGas({...timelineDeployment,from:owner});
 const fees=await ethers.provider.getFeeData(),recommendedFee=fees.maxFeePerGas||fees.gasPrice;assert.ok(recommendedFee);
 const budget=(nftGas+timelineGas)*12n/10n+2500000n+BigInt(identityCount)*400000n+BigInt(timelineCount)*800000n+BigInt(progress.length)*600000n+1800000n;
 const balance=await ethers.provider.getBalance(owner);
 const latest=await ethers.provider.getBlock('latest');assert.ok(latest?.baseFeePerGas);
 const priority=fees.maxPriorityFeePerGas||30000000000n;
 const minimumCap=(latest.baseFeePerGas+priority)*12n/10n;
 const minimumBudget=budget*minimumCap+ethers.parseEther('1');
 if(balance<minimumBudget)console.log(JSON.stringify({check:'funding_shortfall',gasUnits:budget.toString(),minimumRequiredPOL:ethers.formatEther(minimumBudget),balancePOL:ethers.formatEther(balance),shortfallPOL:ethers.formatEther(minimumBudget-balance),baseFeeGwei:ethers.formatUnits(latest.baseFeePerGas,9),priorityFeeGwei:ethers.formatUnits(priority,9)}));
 const fee=fundedFeeCap({gasUnits:budget,balance,reserve:ethers.parseEther('1'),baseFee:latest.baseFeePerGas,priority,recommended:recommendedFee});
 console.log(JSON.stringify({check:'owner_funding',gasUnits:budget.toString(),maxFeeGwei:ethers.formatUnits(fee,9),requiredPOL:ethers.formatEther(budget*fee),balancePOL:ethers.formatEther(balance)}));
 assert.ok(balance>budget*fee,'Fund the approved owner wallet before deploying');
 const plan={preparedAt:new Date().toISOString(),chainId:137,owner,nonce,mode:'unsigned_preparation',legacy:contracts,expected:{IdentityNFT:nftAddress,PaymentSplitter:splitterAddress,Timeline:timelineAddress},identityCount,tokenCount,timelineCount,definitions,tokens,timelines,progress,bytecodeHashes:{IdentityNFT:ethers.keccak256(nftArtifact.bytecode),Timeline:ethers.keccak256(timelineArtifact.bytecode)},maxFeePerGasWei:fee.toString(),maxPriorityFeePerGasWei:priority.toString(),ownerGasBudgetPOL:ethers.formatEther(budget*fee),ownerBalancePOL:ethers.formatEther(balance),holderMigrationGasBudgetPerTokenPOL:ethers.formatEther(800000n*fee),requirements:'Maintenance; receipt verification; each holder safely transfers originals into NFTV4; finalize both migrations; preserve historical ledgers and legacy payouts; activate matching API/frontend addresses; retest live'};
 fs.writeFileSync('deployments/polygon-standard-v4-plan.json',encode(plan)+'\n');
 console.log(JSON.stringify({mode:plan.mode,owner,identityCount,tokenCount,timelineCount,progressUsers:progress.length,ownerGasBudgetPOL:plan.ownerGasBudgetPOL,ownerBalancePOL:plan.ownerBalancePOL,holderMigrationGasBudgetPerTokenPOL:plan.holderMigrationGasBudgetPerTokenPOL,expected:plan.expected}));
}
main().catch(error=>{console.error(String(error.message||error.code).replace(/https?:\/\/\S+/g,'[endpoint]'));process.exitCode=1});
