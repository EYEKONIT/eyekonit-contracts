import { ethers } from 'hardhat';
import fs from 'node:fs';
import assert from 'node:assert/strict';

// Read-only: produces unsigned owner transactions, never loads or uses a signer.
async function main() {
  const release = JSON.parse(fs.readFileSync('deployments/polygon-v2.2.json','utf8'));
  const owner = '0x988d0D4f9E58913440B52B2dAa0c472E7CB7f64D';
  const addresses = release.contracts;
  assert.equal(Number((await ethers.provider.getNetwork()).chainId),137);
  const legacy = new ethers.Contract(addresses.Timeline,(await import('../artifacts/contracts/TimelineV2.sol/TimelineV2.json')).abi,ethers.provider);
  const nft = new ethers.Contract(addresses.IdentityNFT,(await import('../artifacts/contracts/IdentityNFTV2.sol/IdentityNFTV2.json')).abi,ethers.provider);
  assert.equal((await legacy.owner()).toLowerCase(),owner.toLowerCase());
  assert.equal((await nft.owner()).toLowerCase(),owner.toLowerCase());
  assert.equal((await nft.timeline()).toLowerCase(),addresses.Timeline.toLowerCase());
  const count = Number(await legacy.getTotalTimelines());
  const originals = [];
  const progressImports: {timelineId:number,user:string,completed:string[],lastCompletedAt:string,isComplete:boolean}[] = [];
  for(let id=1;id<=count;id++) {
    const holders = Number(await legacy.timelineHolderCount(id));
    const data = await legacy.getTimeline(id), chapters=[];
    for(let chapter=1;chapter<=Number(data.totalChapters);chapter++) {
      const item=await legacy.getChapter(id,chapter);
      if(item.identityId!==0n) chapters.push({chapterNumber:chapter,identityId:item.identityId.toString(),requiresPrevious:item.requiresPrevious,addedAt:item.addedAt.toString()});
    }
    originals.push({id,creator:data.creator,organizationId:data.organizationId.toString(),name:data.name,description:data.description,totalChapters:Number(data.totalChapters),holderDiscount:Number(data.holderDiscount),isActive:data.isActive,createdAt:data.createdAt.toString(),chapters});
    if(holders>0) {
      const logProvider = new ethers.JsonRpcProvider('https://polygon.drpc.org',137,{staticNetwork:true});
      try {
        const logContract = new ethers.Contract(addresses.Timeline,legacy.interface,logProvider);
        const users = new Set<string>();
        const from = Number(release.deploymentTransactions.TimelineV2.blockNumber || release.syncStartBlock || 94789009);
        const head = await ethers.provider.getBlockNumber();
        for(let start=from;start<=head&&users.size<holders;start+=2000) {
          for(const event of await logContract.queryFilter(logContract.filters.ChapterCompleted(id),start,Math.min(head,start+1999))) {
            if('args' in event) users.add(String(event.args.user).toLowerCase());
          }
        }
        assert.equal(users.size,holders,`Legacy timeline ${id}: history enumeration is incomplete`);
        for(const user of [...users].sort()) {
          const [completed,completedCount,isComplete]=await legacy.getUserProgress(id,user);
          const stored=await legacy.userProgress(id,user);
          assert.equal(Number(completedCount),completed.length);assert.ok(completed.length>0);
          progressImports.push({timelineId:id,user,completed:completed.map((value:bigint)=>value.toString()),lastCompletedAt:stored.lastCompletedAt.toString(),isComplete});
        }
      } finally {logProvider.destroy();}
    }
  }
  const artifact = await import('../artifacts/contracts/TimelineV3.sol/TimelineV3.json');
  const factory = new ethers.ContractFactory(artifact.abi,artifact.bytecode);
  const deploy = await factory.getDeployTransaction(addresses.AccessControl,addresses.Timeline);
  const nonce = await ethers.provider.getTransactionCount(owner,'pending');
  const replacement = ethers.getCreateAddress({from:owner,nonce});
  const deploymentGas = await ethers.provider.estimateGas({...deploy,from:owner});
  const fees = await ethers.provider.getFeeData();
  const maxFeePerGas = fees.maxFeePerGas || fees.gasPrice;
  assert.ok(maxFeePerGas);
  const chapterCount=originals.reduce((sum,timeline)=>sum+timeline.chapters.length,0);
  const completedCount=progressImports.reduce((sum,progress)=>sum+progress.completed.length,0);
  const conservativeGasBudget = deploymentGas*12n/10n + 400000n + BigInt(count)*500000n + BigInt(chapterCount)*300000n + BigInt(progressImports.length)*250000n + BigInt(completedCount)*70000n;
  const balance = await ethers.provider.getBalance(owner);
  const maxCost = conservativeGasBudget*maxFeePerGas;
  assert.ok(balance>maxCost,'Owner needs more Polygon POL for this budget');
  const txs:any[]=[{label:'Deploy TimelineV3',from:owner,chainId:137,nonce,data:deploy.data,value:'0',gasLimit:(deploymentGas*12n/10n).toString()}];
  const abi = new ethers.Interface(artifact.abi);
  txs.push({label:'Configure the existing IdentityNFT',from:owner,to:replacement,chainId:137,nonce:nonce+1,data:abi.encodeFunctionData('setIdentityContract',[addresses.IdentityNFT]),value:'0'});
  for(let id=1;id<=count;id++) txs.push({label:`Preserve legacy timeline ${id}`,from:owner,to:replacement,chainId:137,nonce:nonce+1+id,data:abi.encodeFunctionData('importLegacyTimeline',[id]),value:'0'});
  txs.push({label:'Route NFT callbacks to replacement and freeze claims until migration is finalized',from:owner,to:addresses.IdentityNFT,chainId:137,nonce:nonce+txs.length,data:nft.interface.encodeFunctionData('setTimelineContract',[replacement]),value:'0'});
  for(const progress of progressImports)txs.push({label:`Preserve progress for timeline ${progress.timelineId}: ${progress.user}`,from:owner,to:replacement,chainId:137,nonce:nonce+txs.length,data:abi.encodeFunctionData('importLegacyProgress',[progress.timelineId,progress.user]),value:'0'});
  txs.push({label:'Verify complete legacy state and finalize migration',from:owner,to:replacement,chainId:137,nonce:nonce+txs.length,data:abi.encodeFunctionData('finalizeMigration',[]),value:'0'});
  const plan={preparedAt:new Date().toISOString(),mode:'unsigned_only',chainId:137,owner,oldTimeline:addresses.Timeline,expectedNewTimeline:replacement,originals,progressImports,transactions:txs,bytecodeHash:ethers.keccak256(artifact.bytecode),maxFeePerGasWei:maxFeePerGas.toString(),conservativeCostPOL:ethers.formatEther(maxCost),ownerBalancePOL:ethers.formatEther(balance),requires:'Maintenance, fresh state recheck, clean owner signing, receipt/metadata/progress verification, migration finalization, frontend/backend address cutover, live acceptance testing'};
  fs.writeFileSync('deployments/polygon-timeline-v3-plan.json',JSON.stringify(plan,null,2)+'\n');
  console.log(JSON.stringify({mode:plan.mode,owner,expectedNewTimeline:replacement,legacyTimelines:count,conservativeCostPOL:plan.conservativeCostPOL,ownerBalancePOL:plan.ownerBalancePOL,transactions:txs.length}));
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1});
