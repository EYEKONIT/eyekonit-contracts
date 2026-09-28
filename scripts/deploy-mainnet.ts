import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

/**
 * Deploy EYEKON contracts to Polygon Mainnet
 * 
 * ⚠️  MAINNET DEPLOYMENT - USE WITH CAUTION ⚠️
 * 
 * Prerequisites:
 * 1. Set PRIVATE_KEY in .env (SECURE THIS!)
 * 2. Set POLYGON_MAINNET_RPC_URL in .env
 * 3. Ensure deployer account has sufficient MATIC for gas
 * 4. Contracts have been audited
 * 5. Contracts have been thoroughly tested on testnet
 * 
 * Run: npx hardhat run scripts/deploy-mainnet.ts --network polygon
 */

async function confirmDeployment(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      "\n⚠️  You are about to deploy to MAINNET. This will cost real MATIC.\n" +
      "   Have you:\n" +
      "   - Audited the contracts?\n" +
      "   - Tested thoroughly on testnet?\n" +
      "   - Backed up your private key securely?\n" +
      "   - Double-checked all contract parameters?\n\n" +
      "Type 'DEPLOY' to continue: ",
      (answer) => {
        rl.close();
        resolve(answer === "DEPLOY");
      }
    );
  });
}

async function main() {
  console.log("🚀 EYEKON Mainnet Deployment Script\n");

  // Confirmation check
  const confirmed = await confirmDeployment();
  if (!confirmed) {
    console.log("\n❌ Deployment cancelled.");
    process.exit(0);
  }

  console.log("\n✅ Proceeding with mainnet deployment...\n");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "MATIC");

  if (balance < ethers.parseEther("1")) {
    console.error("❌ Insufficient balance. Need at least 1 MATIC for deployment.");
    process.exit(1);
  }

  console.log("\n");

  // Deploy AccessControl
  console.log("📦 Deploying AccessControl...");
  const AccessControl = await ethers.getContractFactory("EyekonAccessControl");
  const accessControl = await AccessControl.deploy();
  await accessControl.waitForDeployment();
  const accessControlAddress = await accessControl.getAddress();
  console.log("✅ AccessControl deployed to:", accessControlAddress);

  // Wait for more confirmations on mainnet
  console.log("⏳ Waiting for 10 confirmations...");
  await accessControl.deploymentTransaction()?.wait(10);
  console.log("✅ Confirmed");

  // Deploy IdentityNFT
  console.log("\n📦 Deploying IdentityNFT...");
  const IdentityNFT = await ethers.getContractFactory("IdentityNFT");
  const identityNFT = await IdentityNFT.deploy(accessControlAddress);
  await identityNFT.waitForDeployment();
  const identityNFTAddress = await identityNFT.getAddress();
  console.log("✅ IdentityNFT deployed to:", identityNFTAddress);

  console.log("⏳ Waiting for 10 confirmations...");
  await identityNFT.deploymentTransaction()?.wait(10);
  console.log("✅ Confirmed");

  // Deploy CredentialRegistry
  console.log("\n📦 Deploying CredentialRegistry...");
  const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");
  const credentialRegistry = await CredentialRegistry.deploy(accessControlAddress);
  await credentialRegistry.waitForDeployment();
  const credentialRegistryAddress = await credentialRegistry.getAddress();
  console.log("✅ CredentialRegistry deployed to:", credentialRegistryAddress);

  console.log("⏳ Waiting for 10 confirmations...");
  await credentialRegistry.deploymentTransaction()?.wait(10);
  console.log("✅ Confirmed");

  // Save deployment addresses
  const network = await ethers.provider.getNetwork();
  
  const deployment = {
    network: "polygon",
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

  const deploymentFile = path.join(deploymentsDir, "polygon.json");
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));

  // Also create a backup
  const backupFile = path.join(deploymentsDir, `polygon-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(deployment, null, 2));

  console.log("\n📄 Deployment info saved to:", deploymentFile);
  console.log("📄 Backup saved to:", backupFile);
  console.log("\n✨ Mainnet deployment complete!\n");
  console.log("📋 Contract Addresses:");
  console.log("   AccessControl:", accessControlAddress);
  console.log("   IdentityNFT:", identityNFTAddress);
  console.log("   CredentialRegistry:", credentialRegistryAddress);
  console.log("\n🔍 Verify contracts on PolygonScan:");
  console.log(`   npx hardhat verify --network polygon ${accessControlAddress}`);
  console.log(`   npx hardhat verify --network polygon ${identityNFTAddress} ${accessControlAddress}`);
  console.log(`   npx hardhat verify --network polygon ${credentialRegistryAddress} ${accessControlAddress}`);
  console.log("\n📝 CRITICAL Next Steps:");
  console.log("   1. ⚠️  BACKUP deployment files securely");
  console.log("   2. ⚠️  VERIFY all contracts on PolygonScan");
  console.log("   3. Update production backend .env with contract addresses");
  console.log("   4. Update production frontend .env with contract addresses");
  console.log("   5. Test contract interactions on mainnet with small amounts");
  console.log("   6. Monitor contract activity and gas usage");
  console.log("\n⚠️  Remember: These contracts are immutable once deployed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
