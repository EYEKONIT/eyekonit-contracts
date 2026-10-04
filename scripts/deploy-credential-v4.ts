import { ethers } from 'hardhat';
import { writeFileSync, existsSync } from 'node:fs';

async function main() {
  const expectedOwner='0x988d0D4f9E58913440B52B2dAa0c472E7CB7f64D';
  const accessControl='0x95EB5Cc874a84B966Caed1e39d4056fd2fEbd0ae';
  if((await ethers.provider.getNetwork()).chainId!==137n)throw new Error('Polygon Mainnet is required');
  const [owner]=await ethers.getSigners();
  if(!owner||owner.address.toLowerCase()!==expectedOwner.toLowerCase())throw new Error('The configured signer is not the authorized owner');
  if(await ethers.provider.getCode(accessControl)==='0x')throw new Error('Reviewed access-control deployment is missing');
  const factory=await ethers.getContractFactory('CredentialRegistryV4',owner);
  const data=await factory.getDeployTransaction(accessControl);
  const gas=await ethers.provider.estimateGas({...data,from:owner.address});
  const fees=await ethers.provider.getFeeData();
  const maxFeePerGas=fees.maxFeePerGas??fees.gasPrice;
  if(!maxFeePerGas)throw new Error('A current fee quote is required');
  const gasLimit=gas*125n/100n;
  const required=gasLimit*maxFeePerGas+ethers.parseEther('0.1');
  const balance=await ethers.provider.getBalance(owner.address);
  const budget={chainId:137,owner:owner.address,accessControl,gasEstimate:gas.toString(),gasLimit:gasLimit.toString(),maxFeePerGas:maxFeePerGas.toString(),budgetPOL:ethers.formatEther(required),balancePOL:ethers.formatEther(balance),funded:balance>=required};
  console.log(JSON.stringify(budget));
  if(process.env.DEPLOY_CREDENTIAL_V4!=='1')return;
  if(balance<required)throw new Error('Add Polygon POL to cover the reviewed deployment budget');
  const output='deployments/polygon-credential-v4.json';
  if(existsSync(output))throw new Error('Preserve the existing deployment receipt');
  const registry=await factory.deploy(accessControl,{gasLimit,maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n});
  const tx=registry.deploymentTransaction()!;console.log(JSON.stringify({transactionHash:tx.hash}));
  const receipt=await tx.wait(2);if(!receipt||receipt.status!==1)throw new Error('Deployment was not successful');
  const record={...budget,address:await registry.getAddress(),transactionHash:receipt.hash,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),gasPrice:receipt.gasPrice.toString(),deployedAt:new Date().toISOString(),legacyRegistries:['0xf9B0BCCCCB2C6f61B84835f6fAfA10FfF03126e4','0xE97011413f104CF1394F19Cf882463bDFbe0Ae70']};
  if((await registry.accessControl()).toLowerCase()!==accessControl.toLowerCase())throw new Error('New registry access-control linkage differs');
  writeFileSync(output,JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(record));
}
main().catch(error=>{console.error(error.code||error.name,error.message?.replace(/https?:\/\/\S+/g,'[endpoint]'));process.exitCode=1;});
