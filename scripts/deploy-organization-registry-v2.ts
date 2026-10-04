import { ethers } from 'hardhat';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

async function main() {
  const expectedOwner='0x988d0D4f9E58913440B52B2dAa0c472E7CB7f64D';
  const legacy='0x95EB5Cc874a84B966Caed1e39d4056fd2fEbd0ae';
  assert.equal((await ethers.provider.getNetwork()).chainId,137n);
  const [owner]=await ethers.getSigners(); assert.equal(owner.address.toLowerCase(),expectedOwner.toLowerCase());
  const backing=await ethers.getContractAt('EyekonAccessControl',legacy);
  const originals=[];const count=Number(await backing.getTotalOrganizations());
  for(let id=1;id<=count;id++){const org=await backing.getOrganization(id);originals.push({id,name:org.name,owner:org.owner,createdAt:org.createdAt.toString(),members:await backing.getOrganizationMembers(id)});}
  for(const [name,address] of [['IdentityNFTV3','0xdfEb1cbAAf0FDf4b909A5A12F03Db03b5F18eF15'],['TimelineV4','0xb50Ff5ADa4eCD813607232881EA6f23De55E6e97'],['CredentialRegistryV5','0x094994e2F5d2dadC75f42373F2087e3C5f4410cA']]){
    const consumer=await ethers.getContractAt(name,address);assert.equal((await consumer.accessControl()).toLowerCase(),legacy.toLowerCase());
  }
  const splitter=await ethers.getContractAt('PaymentSplitterV2','0x19715398AA552a345C1800d1f9dA0C133508A5d7');
  assert.equal((await splitter.PLATFORM_WALLET()).toLowerCase(),'0x497574ee15579f9f6836d472eac236f85be4478d');
  assert.equal(await splitter.PLATFORM_FEE_BPS(),2000n);
  const factory=await ethers.getContractFactory('OrganizationRegistryV2',owner),data=await factory.getDeployTransaction(legacy);
  const gasEstimate=await ethers.provider.estimateGas({...data,from:owner.address});
  const fees=await ethers.provider.getFeeData(),maxFeePerGas=fees.maxFeePerGas??fees.gasPrice;
  assert.ok(maxFeePerGas);assert.ok(maxFeePerGas<=ethers.parseUnits('1000','gwei'),'Gas exceeds the reviewed ceiling');
  const gasLimit=gasEstimate*125n/100n,required=gasLimit*maxFeePerGas+ethers.parseEther('0.5'),balance=await ethers.provider.getBalance(owner.address);
  const plan={chainId:137,owner:owner.address,legacyAccessControl:legacy,originals,gasEstimate:gasEstimate.toString(),gasLimit:gasLimit.toString(),maxFeePerGas:maxFeePerGas.toString(),budgetPOL:ethers.formatEther(required),balancePOL:ethers.formatEther(balance),funded:balance>=required};
  console.log(JSON.stringify(plan));
  if(process.env.DEPLOY_ORGANIZATION_V2!=='1')return;
  assert.ok(balance>=required,'Deployment wallet needs additional Polygon POL');
  const output='deployments/polygon-organization-registry-v2.json';
  if(existsSync(output)){
    const prior=JSON.parse(readFileSync(output,'utf8'));assert.ok(prior.transactionHash,'Review the existing deployment record');
    const receipt=await ethers.provider.getTransactionReceipt(prior.transactionHash);assert.equal(receipt?.status,1,'Recorded deployment needs review');
    console.log(JSON.stringify({alreadyDeployed:true,address:receipt.contractAddress}));return;
  }
  const registry=await factory.deploy(legacy,{gasLimit,maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n});
  const transaction=registry.deploymentTransaction()!;
  const record={...plan,address:await registry.getAddress(),transactionHash:transaction.hash,status:'submitted',bytecodeHash:ethers.keccak256(factory.bytecode)};
  writeFileSync(output,JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({transactionHash:transaction.hash}));
  const receipt=await transaction.wait(2);assert.equal(receipt?.status,1);
  assert.equal((await registry.legacyAccessControl()).toLowerCase(),legacy.toLowerCase());
  const final={...record,status:'deployed',blockNumber:receipt!.blockNumber,gasUsed:receipt!.gasUsed.toString(),gasPrice:receipt!.gasPrice.toString(),deployedAt:new Date().toISOString()};
  writeFileSync(output,JSON.stringify(final,null,2)+'\n');console.log(JSON.stringify(final));
}
main().catch(error=>{console.error(error.code||error.name,error.message?.replace(/https?:\/\/\S+/g,'[endpoint]'));process.exitCode=1;});
