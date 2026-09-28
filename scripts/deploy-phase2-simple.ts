import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Simple Phase 2 deployment - just deploy Timeline and PaymentSplitter
 * Skip the IdentityNFT update step (can be done manually later)
 */
async function main() {
  console.log("Starting Phase 2 deployment (simple)...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "MATIC");

  // Load existing deployment
  const deploymentPath = path.join(__dirname, "../deployments/amoy.json");
  let deployment: any = {};
  
  if (fs.existsSync(deploymentPath)) {
    deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    console.log("\nExisting deployment loaded");
  } else {
    throw new Error("No existing deployment found. Run deploy-amoy.ts first.");
  }

  // Deploy Timeline contract
  console.log("\nDeploying Timeline contract...");
  const Timeline = await ethers.getContractFactory("Timeline");
  const timeline = await Timeline.deploy();
  await timeline.waitForDeployment();
  const timelineAddress = await timeline.getAddress();
  console.log("✅ Timeline deployed to:", timelineAddress);

  // Wait for confirmations
  console.log("⏳ Waiting for 5 confirmations...");
  await timeline.deploymentTransaction()?.wait(5);
  console.log("✅ Confirmed");

  // Deploy PaymentSplitter contract
  console.log("\nDeploying PaymentSplitter contract...");
  const PaymentSplitter = await ethers.getContractFactory("PaymentSplitter");
  const paymentSplitter = await PaymentSplitter.deploy();
  await paymentSplitter.waitForDeployment();
  const paymentSplitterAddress = await paymentSplitter.getAddress();
  console.log("✅ PaymentSplitter deployed to:", paymentSplitterAddress);

  // Wait for confirmations
  console.log("⏳ Waiting for 5 confirmations...");
  await paymentSplitter.deploymentTransaction()?.wait(5);
  console.log("✅ Confirmed");

  // Update deployment file
  deployment.contracts.Timeline = timelineAddress;
  deployment.contracts.PaymentSplitter = paymentSplitterAddress;
  deployment.phase2DeployedAt = new Date().toISOString();
  deployment.gasUsed = deployment.gasUsed || {};
  deployment.gasUsed.Timeline = (await timeline.deploymentTransaction()?.wait())?.gasUsed.toString();
  deployment.gasUsed.PaymentSplitter = (await paymentSplitter.deploymentTransaction()?.wait())?.gasUsed.toString();

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("\n📄 Deployment file updated");

  // Print summary
  console.log("\n✨ Phase 2 Deployment Complete!");
  console.log("\n📋 Contract Addresses:");
  console.log("   Timeline:", timelineAddress);
  console.log("   PaymentSplitter:", paymentSplitterAddress);
  
  console.log("\n🔍 Verify contracts on Amoy PolygonScan:");
  console.log(`   npx hardhat verify --network amoy ${timelineAddress}`);
  console.log(`   npx hardhat verify --network amoy ${paymentSplitterAddress}`);

  console.log("\n📝 Next steps:");
  console.log("   1. Update backend .env with new contract addresses:");
  console.log(`      TIMELINE_CONTRACT_ADDRESS=${timelineAddress}`);
  console.log(`      PAYMENT_SPLITTER_CONTRACT_ADDRESS=${paymentSplitterAddress}`);
  console.log("   2. Restart backend to initialize new event listeners");
  console.log("   3. Test Timeline and PaymentSplitter event indexing");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
