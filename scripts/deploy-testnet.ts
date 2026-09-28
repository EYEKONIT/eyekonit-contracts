import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy EYEKON contracts to Polygon Mumbai Testnet
 * 
 * Prerequisites:
 * 1. Set PRIVATE_KEY in .env
 * 2. Set POLYGON_MUMBAI_RPC_URL in .env
 * 3. Ensure deployer account has testnet MATIC (get from faucet)
 * 
 * Run: npx hardhat run scripts/deploy-testnet.ts --network mumbai
 */
async function main() {
  console.log("🚀 Deploying EYEKON contracts to Polygon Mumbai Testnet...\n");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "MATIC");

  if (balance < ethers.parseEther("0.1")) {
    console.warn("⚠️  Warning: Low balance. Get testnet MATIC from https://faucet.polygon.technology/");
  }

  console.log("\n");

  // Deploy AccessControl
  console.log("📦 Deploying AccessControl...");
  const AccessControl = await ethers.getContractFactory("EyekonAccessControl");
  const accessControl = await AccessControl.deploy();
  await accessControl.waitForDeployment();
  const accessControlAddress = await accessControl.getAddress();
  console.log("✅ AccessControl deployed to:", accessControlAddress);

  // Wait for confirmations
  console.log("⏳ Waiting for 5 confirmations...");
  await accessControl.deploymentTransaction()?.wait(5);
  console.log("✅ Confirmed");

  // Deploy IdentityNFT
  console.log("\n📦 Deploying IdentityNFT...");
  const IdentityNFT = await ethers.getContractFactory("IdentityNFT");
  const identityNFT = await IdentityNFT.deploy(accessControlAddress);
  await identityNFT.waitForDeployment();
  const identityNFTAddress = await identityNFT.getAddress();
  console.log("✅ IdentityNFT deployed to:", identityNFTAddress);

  console.log("⏳ Waiting for 5 confirmations...");
  await identityNFT.deploymentTransaction()?.wait(5);
  console.log("✅ Confirmed");

  // Deploy CredentialRegistry
  console.log("\n📦 Deploying CredentialRegistry...");
  const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");
  const credentialRegistry = await CredentialRegistry.deploy(accessControlAddress);
  await credentialRegistry.waitForDeployment();
  const credentialRegistryAddress = await credentialRegistry.getAddress();
  console.log("✅ CredentialRegistry deployed to:", credentialRegistryAddress);

  console.log("⏳ Waiting for 5 confirmations...");
  await credentialRegistry.deploymentTransaction()?.wait(5);
  console.log("✅ Confirmed");

  // Save deployment addresses
  const network = await ethers.provider.getNetwork();
  
  const deployment = {
    network: "mumbai",
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      AccessControl: accessControlAddress,
      IdentityNFT: identityNFTAddress,
      CredentialRegistry: credentialRegistryAddress,
    },
    gasUsed: {
      AccessControl: (await accessControl.deploymentTransaction()?.wait())?.gasUsed.toString(),
      IdentityNFT: (await identityNFT.deploymentTransaction()?.wait())?.gasUsed.toString(),
      CredentialRegistry: (await credentialRegistry.deploymentTransaction()?.wait())?.gasUsed.toString(),
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, "mumbai.json");
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));

  console.log("\n📄 Deployment info saved to:", deploymentFile);
  console.log("\n✨ Deployment complete!\n");
  console.log("📋 Contract Addresses:");
  console.log("   AccessControl:", accessControlAddress);
  console.log("   IdentityNFT:", identityNFTAddress);
  console.log("   CredentialRegistry:", credentialRegistryAddress);
  console.log("\n🔍 Verify contracts on Mumbai PolygonScan:");
  console.log(`   npx hardhat verify --network mumbai ${accessControlAddress}`);
  console.log(`   npx hardhat verify --network mumbai ${identityNFTAddress} ${accessControlAddress}`);
  console.log(`   npx hardhat verify --network mumbai ${credentialRegistryAddress} ${accessControlAddress}`);
  console.log("\n📝 Next steps:");
  console.log("   1. Update backend .env with contract addresses");
  console.log("   2. Update frontend .env with contract addresses");
  console.log("   3. Test contract interactions on testnet");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
