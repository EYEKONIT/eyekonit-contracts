import { ethers, network } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Deploy only the replacement splitter. Activation is a separate owner action. */
async function main() {
  if (![80002, 137].includes(network.config.chainId ?? 0)) throw new Error('Use Polygon Amoy or Polygon');
  const identityAddress = process.env.COMMISSION_IDENTITY_ADDRESS;
  if (!identityAddress || !ethers.isAddress(identityAddress)) throw new Error('COMMISSION_IDENTITY_ADDRESS is required');
  const identity = await ethers.getContractAt('IdentityNFTV2', identityAddress);
  const [owner, previousSplitter, identityCount] = await Promise.all([
    identity.owner(), identity.paymentSplitter(), identity.getTotalIdentities(),
  ]);
  const factory = await ethers.getContractFactory('PaymentSplitterV2');
  const deployTransaction = await factory.getDeployTransaction(identityAddress);
  const signer = (await ethers.getSigners())[0];
  if (!signer) throw new Error('A deployer wallet must be configured');
  const gas = await signer.estimateGas(deployTransaction);
  console.log(JSON.stringify({ chainId: network.config.chainId, identityAddress, owner, previousSplitter, existingIdentities: identityCount.toString(), estimatedDeploymentGas: gas.toString(), platformWallet: '0x497574ee15579f9f6836d472eac236f85be4478d', platformFeeBps: 2000 }, null, 2));
  if (process.env.DEPLOY_COMMISSION_SPLITTER !== 'true') {
    console.log('Read-only preflight complete. Set DEPLOY_COMMISSION_SPLITTER=true only after rollout approval.');
    return;
  }
  const splitter = await factory.deploy(identityAddress);
  await splitter.waitForDeployment();
  const address = await splitter.getAddress();
  const activationData = identity.interface.encodeFunctionData('setPaymentSplitter', [address]);
  const manifest = {
    version: 'commission-80-20', chainId: network.config.chainId,
    identityAddress, identityOwner: owner, previousSplitter, paymentSplitter: address,
    deploymentHash: splitter.deploymentTransaction()?.hash,
    platformWallet: await splitter.PLATFORM_WALLET(), platformFeeBps: Number(await splitter.PLATFORM_FEE_BPS()),
    // The identity owner (or Safe) submits this after verifying the replacement.
    activation: { to: identityAddress, data: activationData, value: '0' },
    createdAt: new Date().toISOString(),
  };
  const destination = path.join(__dirname, '..', 'deployments', `commission-${network.config.chainId}-${Date.now()}.json`);
  fs.writeFileSync(destination, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log('Splitter deployed; NOT activated. Manifest:', destination);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
