import { ethers, artifacts, network } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const file = process.env.COMMISSION_MANIFEST;
  if (!file) throw new Error('COMMISSION_MANIFEST is required');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (network.config.chainId !== manifest.chainId) throw new Error('Wrong chain');
  const splitter = await ethers.getContractAt('PaymentSplitterV2', manifest.paymentSplitter);
  const artifact = await artifacts.readArtifact('PaymentSplitterV2');
  const build = await artifacts.getBuildInfo('contracts/PaymentSplitterV2.sol:PaymentSplitterV2');
  if (!build) throw new Error('Compiled build information is unavailable');
  const deployed = build.output.contracts['contracts/PaymentSplitterV2.sol'].PaymentSplitterV2.evm.deployedBytecode;
  const normalize = (code: string) => {
    const bytes = code.slice(2).split('');
    for (const references of Object.values(deployed.immutableReferences ?? {})) {
      for (const reference of references) bytes.fill('0', reference.start * 2, (reference.start + reference.length) * 2);
    }
    return '0x' + bytes.join('');
  };
  const code = await ethers.provider.getCode(manifest.paymentSplitter);
  if (normalize(code) !== normalize(artifact.deployedBytecode)) throw new Error('Deployed bytecode does not match the tested build');
  if ((await splitter.identityContract()).toLowerCase() !== manifest.identityAddress.toLowerCase() ||
      (await splitter.PLATFORM_WALLET()).toLowerCase() !== '0x497574ee15579f9f6836d472eac236f85be4478d' ||
      await splitter.PLATFORM_FEE_BPS() !== 2000n ||
      (await splitter.legacySplitter()).toLowerCase() !== manifest.previousSplitter.toLowerCase()) throw new Error('Invalid payment configuration');
  const identity = await ethers.getContractAt('IdentityNFTV2', manifest.identityAddress);
  const [signer] = await ethers.getSigners();
  if ((await identity.owner()).toLowerCase() !== signer.address.toLowerCase()) throw new Error('Identity owner signer required');
  const count = await identity.getTotalIdentities();
  const old = new ethers.Contract(manifest.previousSplitter, [
    'function isRoyaltyConfigured(uint256) view returns(bool)',
    'function getSplits(uint256) view returns(address[],uint16[])',
    'function getRoyaltyPercentage(uint256) view returns(uint16)',
  ], ethers.provider);
  for (let id = 1n; id <= count; id++) {
    if (await old.isRoyaltyConfigured(id)) {
      const [before, after] = await Promise.all([old.getSplits(id), splitter.getSplits(id)]);
      if (JSON.stringify(before, (_, value) => typeof value === 'bigint' ? value.toString() : value) !==
          JSON.stringify(after, (_, value) => typeof value === 'bigint' ? value.toString() : value) ||
          await old.getRoyaltyPercentage(id) !== await splitter.getRoyaltyPercentage(id)) throw new Error('Existing royalties would be lost');
    }
  }
  const current = await identity.paymentSplitter();
  if (current.toLowerCase() !== manifest.paymentSplitter.toLowerCase()) {
    if (current.toLowerCase() !== manifest.previousSplitter.toLowerCase()) throw new Error('Unexpected current splitter; stop before activation');
    const tx = await identity.setPaymentSplitter(manifest.paymentSplitter);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Activation failed');
    manifest.activationHash = receipt.hash;
    manifest.activationBlock = receipt.blockNumber;
    manifest.activatedAt = new Date().toISOString();
  }
  if ((await identity.paymentSplitter()).toLowerCase() !== manifest.paymentSplitter.toLowerCase() || await identity.getTotalIdentities() !== count) throw new Error('Activation verification failed');
  manifest.bytecodeVerified = true;
  manifest.existingIdentityCount = count.toString();
  fs.writeFileSync(path.resolve(file), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ paymentSplitter: manifest.paymentSplitter, activationHash: manifest.activationHash, activationBlock: manifest.activationBlock, identityCount: count.toString(), bytecodeVerified: true, royaltySettingsPreserved: true }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
