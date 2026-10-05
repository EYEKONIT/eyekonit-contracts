import {ethers,run} from 'hardhat';
import fs from 'node:fs';
import assert from 'node:assert/strict';
async function main(){
 const plan=JSON.parse(fs.readFileSync('deployments/polygon-standard-v4-plan.json','utf8')),state=JSON.parse(fs.readFileSync('deployments/polygon-standard-v4-staged.json','utf8'));
 assert.equal(Number((await ethers.provider.getNetwork()).chainId),137);
 for(const [name,address,args]of [
  ['IdentityNFTV4',state.contracts.IdentityNFT,[plan.legacy.AccessControl,plan.legacy.IdentityNFT,plan.retiredIdentityIds]],
  ['PaymentSplitterV2',state.contracts.PaymentSplitter,[state.contracts.IdentityNFT]],
  ['TimelineV5',state.contracts.Timeline,[plan.legacy.AccessControl,plan.legacy.Timeline]],
 ] as Array<[string,string,unknown[]]>){
  assert.notEqual(await ethers.provider.getCode(address),'0x');
  try{await run('verify:verify',{address,constructorArguments:args,contract:`contracts/${name}.sol:${name}`});console.log(JSON.stringify({name,address,verified:true}));}
  catch(error){const message=String((error as Error).message);if(/already verified/i.test(message))console.log(JSON.stringify({name,address,verified:true,alreadyVerified:true}));else throw error;}
 }
}
main().catch(error=>{console.error(String(error.message||error.code).replace(/https?:\/\/\S+/g,'[endpoint]'));process.exitCode=1});
