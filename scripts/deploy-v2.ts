import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const chainId = Number(network.config.chainId);
  if (![80002, 137].includes(chainId)) {
    throw new Error("V2 deployment supports only Polygon Amoy (80002) and Polygon PoS mainnet (137)");
  }
  const actualChainId = Number(await ethers.provider.send("eth_chainId", []));
  if (actualChainId !== chainId) throw new Error("RPC chain does not match the selected deployment network");
  if (chainId === 137 && process.env.CONFIRM_POLYGON_MAINNET !== "137") {
    throw new Error("Set CONFIRM_POLYGON_MAINNET=137 only for an approved real-POL deployment");
  }
  const ownerSuffix = (process.env.EXPECTED_DEPLOYER_ADDRESS || '').slice(2, 10).toLowerCase();
  if (!/^[a-f0-9]{8}$/.test(ownerSuffix)) throw new Error("Set EXPECTED_DEPLOYER_ADDRESS before deployment");
  const outputPath = path.join(__dirname, "..", "deployments", chainId === 137 ? "polygon-v2.2.json" : `amoy-v2.2-owner-${ownerSuffix}.json`);
  if (fs.existsSync(outputPath)) throw new Error(`Deployment manifest already exists: ${outputPath}. Review it before deploying another system.`);

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Configure a secure deployment signer before deployment");
  const expectedDeployer = process.env.EXPECTED_DEPLOYER_ADDRESS;
  if (!expectedDeployer || !ethers.isAddress(expectedDeployer)) throw new Error("EXPECTED_DEPLOYER_ADDRESS must identify the approved deployment wallet");
  if (deployer.address.toLowerCase() !== expectedDeployer.toLowerCase()) throw new Error("Deployment signer does not match EXPECTED_DEPLOYER_ADDRESS; no transactions were sent");
  if (deployer.address.toLowerCase() === "0xe6dfcdfec1c431d77c046d3d2a3cedce27407541") throw new Error("The compromised legacy wallet is permanently blocked from deployment");
  const platformAdmin = process.env.PLATFORM_ADMIN_ADDRESS;
  if (!platformAdmin || !ethers.isAddress(platformAdmin)) {
    throw new Error("PLATFORM_ADMIN_ADDRESS must be a valid dedicated admin or Safe address");
  }

  console.log("Deploying EYEKON V2 user-owned contracts");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Platform admin:", platformAdmin);

  const journalPath = `${outputPath}.partial.json`;
  const journal: any = fs.existsSync(journalPath)
    ? JSON.parse(fs.readFileSync(journalPath, "utf8"))
    : { chainId, deployer: deployer.address, contracts: {} };
  if (journal.chainId !== chainId || journal.deployer.toLowerCase() !== deployer.address.toLowerCase()) throw new Error("Partial deployment belongs to another chain or deployer");
  const saveJournal = () => fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  async function deployContract(name: string, args: string[] = []): Promise<any> {
    const factory = await ethers.getContractFactory(name);
    const bytecodeHash = ethers.keccak256(factory.bytecode);
    const previous = journal.contracts[name];
    if (previous) {
      if (previous.bytecodeHash !== bytecodeHash) throw new Error(`Compiled ${name} changed during a partial deployment`);
      if (await ethers.provider.getCode(previous.address) === "0x") {
        const receipt = await ethers.provider.waitForTransaction(previous.transactionHash, chainId === 137 ? 3 : 1);
        if (!receipt || receipt.status !== 1) throw new Error(`Review failed deployment of ${name}`);
      }
      return factory.attach(previous.address);
    }
    const contract = await factory.deploy(...args);
    journal.contracts[name] = { address: await contract.getAddress(), transactionHash: contract.deploymentTransaction()!.hash, bytecodeHash, constructorArguments: args };
    saveJournal();
    const receipt = await contract.deploymentTransaction()!.wait(chainId === 137 ? 3 : 1);
    if (!receipt || receipt.status !== 1) throw new Error(`${name} deployment failed`);
    journal.contracts[name].deploymentBlock = receipt.blockNumber;
    saveJournal();
    return contract;
  }

  const access = await deployContract("EyekonAccessControl");
  await access.waitForDeployment();

  const identity = await deployContract("IdentityNFTV2", [await access.getAddress()]);
  await identity.waitForDeployment();

  const timeline = await deployContract("TimelineV2", [await access.getAddress()]);
  await timeline.waitForDeployment();

  const credential = await deployContract("CredentialRegistryV2", [await access.getAddress()]);
  await credential.waitForDeployment();

  const payment = await deployContract("PaymentSplitterV2", [await identity.getAddress()]);
  await payment.waitForDeployment();

  if ((await identity.timeline()).toLowerCase() !== (await timeline.getAddress()).toLowerCase()) await (await identity.setTimelineContract(await timeline.getAddress())).wait();
  if ((await identity.paymentSplitter()).toLowerCase() !== (await payment.getAddress()).toLowerCase()) await (await identity.setPaymentSplitter(await payment.getAddress())).wait();
  if ((await timeline.identityContract()).toLowerCase() !== (await identity.getAddress()).toLowerCase()) await (await timeline.setIdentityContract(await identity.getAddress())).wait();

  const treasury = "0x497574ee15579f9f6836d472eac236f85be4478d";
  if ((await payment.PLATFORM_WALLET()).toLowerCase() !== treasury || await payment.PLATFORM_FEE_BPS() !== 2000n) {
    throw new Error("Deployed payment splitter does not implement the approved 20% treasury fee");
  }
  if ((await identity.paymentSplitter()).toLowerCase() !== (await payment.getAddress()).toLowerCase() ||
      (await identity.timeline()).toLowerCase() !== (await timeline.getAddress()).toLowerCase() ||
      (await timeline.identityContract()).toLowerCase() !== (await identity.getAddress()).toLowerCase()) {
    throw new Error("Contract wiring verification failed");
  }

  if (platformAdmin.toLowerCase() !== deployer.address.toLowerCase()) {
    const defaultAdminRole = await access.DEFAULT_ADMIN_ROLE();
    const adminRole = await access.ADMIN_ROLE();
    if (!await access.hasRole(defaultAdminRole, platformAdmin)) await (await access.grantRole(defaultAdminRole, platformAdmin)).wait();
    if (!await access.hasRole(adminRole, platformAdmin)) await (await access.grantRole(adminRole, platformAdmin)).wait();
    if ((await identity.owner()).toLowerCase() !== platformAdmin.toLowerCase()) await (await identity.transferOwnership(platformAdmin)).wait();
    if ((await timeline.owner()).toLowerCase() !== platformAdmin.toLowerCase()) await (await timeline.transferOwnership(platformAdmin)).wait();
    if (await access.hasRole(adminRole, deployer.address)) await (await access.renounceRole(adminRole, deployer.address)).wait();
    if (await access.hasRole(defaultAdminRole, deployer.address)) await (await access.renounceRole(defaultAdminRole, deployer.address)).wait();
  }

  const addresses = {
    AccessControl: await access.getAddress(),
    IdentityNFT: await identity.getAddress(),
    Timeline: await timeline.getAddress(),
    CredentialRegistry: await credential.getAddress(),
    PaymentSplitter: await payment.getAddress(),
  };
  const deployment = {
    version: "2.2",
    network: network.name,
    chainId,
    nativeCurrency: "POL",
    platformTreasury: treasury,
    platformFeeBps: 2000,
    deployer: deployer.address,
    platformAdmin,
    timestamp: new Date().toISOString(),
    contracts: addresses,
    deploymentTransactions: journal.contracts,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`, {
    flag: "wx",
  });
  console.log("Deployment saved:", outputPath);
  console.table(addresses);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
