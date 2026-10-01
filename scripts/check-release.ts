import { ethers, network } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';

async function main() {
  const manifestPath = process.env.DEPLOYMENT_MANIFEST || 'deployments/polygon-v2.2.json';
  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  assert.equal(chainId, manifest.chainId, 'RPC chain differs from release manifest');
  assert.equal(chainId, network.config.chainId, 'Hardhat network differs from RPC');
  assert.equal(manifest.deployer.toLowerCase(), '0x988d0d4f9e58913440b52b2daa0c472e7cb7f64d');
  const checks: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(manifest.deploymentTransactions) as [string, any][]) {
    const factory = await ethers.getContractFactory(name);
    assert.equal(ethers.keccak256(factory.bytecode), entry.bytecodeHash, `${name} compiled artifact changed`);
    const tx = await ethers.provider.getTransaction(entry.transactionHash);
    const receipt = await ethers.provider.getTransactionReceipt(entry.transactionHash);
    assert.ok(tx && receipt, `${name} deployment not found`);
    assert.equal(receipt.status, 1, `${name} deployment failed`);
    assert.equal(receipt.contractAddress?.toLowerCase(), entry.address.toLowerCase());
    assert.equal(tx.from.toLowerCase(), manifest.deployer.toLowerCase());
    assert.equal(tx.data, (await factory.getDeployTransaction(...entry.constructorArguments)).data);
    const code = await ethers.provider.getCode(entry.address);
    assert.notEqual(code, '0x', `${name} runtime bytecode missing`);
    checks[name] = { address: entry.address, block: receipt.blockNumber, runtimeCodeHash: ethers.keccak256(code) };
  }
  const a = manifest.contracts;
  const access: any = await ethers.getContractAt('EyekonAccessControl', a.AccessControl);
  const identity: any = await ethers.getContractAt('IdentityNFTV2', a.IdentityNFT);
  const timeline: any = await ethers.getContractAt('TimelineV2', a.Timeline);
  const credential: any = await ethers.getContractAt('CredentialRegistryV2', a.CredentialRegistry);
  const payment: any = await ethers.getContractAt('PaymentSplitterV2', a.PaymentSplitter);
  const equalAddress = (actual: string, expected: string) => assert.equal(actual.toLowerCase(), expected.toLowerCase());
  equalAddress(await identity.owner(), manifest.platformAdmin);
  equalAddress(await timeline.owner(), manifest.platformAdmin);
  for (const contract of [identity, timeline, credential]) equalAddress(await contract.accessControl(), a.AccessControl);
  assert.ok(await access.hasRole(await access.DEFAULT_ADMIN_ROLE(), manifest.platformAdmin));
  assert.ok(await access.hasRole(await access.ADMIN_ROLE(), manifest.platformAdmin));
  for (const role of [await access.DEFAULT_ADMIN_ROLE(), await access.ADMIN_ROLE()]) {
    assert.equal(await access.hasRole(role, '0xE6dfCDfec1C431d77c046D3D2a3CEdcE27407541'), false, 'Compromised wallet retains admin role');
  }
  equalAddress(await identity.timeline(), a.Timeline);
  equalAddress(await identity.paymentSplitter(), a.PaymentSplitter);
  equalAddress(await timeline.identityContract(), a.IdentityNFT);
  equalAddress(await payment.PLATFORM_WALLET(), '0x497574ee15579f9f6836d472eac236f85be4478d');
  assert.equal(await payment.PLATFORM_FEE_BPS(), 2000n);
  const report = { checkedAt: new Date().toISOString(), chainId, checks, owner: manifest.platformAdmin, treasury: await payment.PLATFORM_WALLET(), platformFeeBps: 2000, balancePOL: ethers.formatEther(await ethers.provider.getBalance(manifest.deployer)), result: 'passed' };
  fs.writeFileSync(`${manifestPath}.checks.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
