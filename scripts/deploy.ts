import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  if (Number(await ethers.provider.send("eth_chainId", [])) === 137) {
    throw new Error("V1 Polygon mainnet deployment is disabled; use npm run deploy:polygon:v2.");
  }
  console.log("🚀 Deploying EYEKON contracts...\n");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH\n");

  // Deploy AccessControl
  console.log("📦 Deploying AccessControl...");
  const AccessControl = await ethers.getContractFactory("EyekonAccessControl");
  const accessControl = await AccessControl.deploy();
  await accessControl.waitForDeployment();
  const accessControlAddress = await accessControl.getAddress();
  console.log("✅ AccessControl deployed to:", accessControlAddress);

  // Deploy IdentityNFT
  console.log("\n📦 Deploying IdentityNFT...");
  const IdentityNFT = await ethers.getContractFactory("IdentityNFT");
  const identityNFT = await IdentityNFT.deploy(accessControlAddress);
  await identityNFT.waitForDeployment();
  const identityNFTAddress = await identityNFT.getAddress();
  console.log("✅ IdentityNFT deployed to:", identityNFTAddress);

  // Deploy CredentialRegistry
  console.log("\n📦 Deploying CredentialRegistry...");
  const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");
  const credentialRegistry = await CredentialRegistry.deploy(accessControlAddress);
  await credentialRegistry.waitForDeployment();
  const credentialRegistryAddress = await credentialRegistry.getAddress();
  console.log("✅ CredentialRegistry deployed to:", credentialRegistryAddress);

  // Save deployment addresses
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === "unknown" ? "localhost" : network.name;
  
  const deployment = {
    network: networkName,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      AccessControl: accessControlAddress,
      IdentityNFT: identityNFTAddress,
      CredentialRegistry: credentialRegistryAddress,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));

  console.log("\n📄 Deployment info saved to:", deploymentFile);
  console.log("\n✨ Deployment complete!\n");
  console.log("📋 Contract Addresses:");
  console.log("   AccessControl:", accessControlAddress);
  console.log("   IdentityNFT:", identityNFTAddress);
  console.log("   CredentialRegistry:", credentialRegistryAddress);
  console.log("\n🔍 Verify contracts on PolygonScan:");
  console.log(`   npx hardhat verify --network ${networkName} ${accessControlAddress}`);
  console.log(`   npx hardhat verify --network ${networkName} ${identityNFTAddress} ${accessControlAddress}`);
  console.log(`   npx hardhat verify --network ${networkName} ${credentialRegistryAddress} ${accessControlAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
