import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Starting Phase 2 deployment...");

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
  console.log("Timeline deployed to:", timelineAddress);

  // Deploy PaymentSplitter contract
  console.log("\nDeploying PaymentSplitter contract...");
  const PaymentSplitter = await ethers.getContractFactory("PaymentSplitter");
  const paymentSplitter = await PaymentSplitter.deploy();
  await paymentSplitter.waitForDeployment();
  const paymentSplitterAddress = await paymentSplitter.getAddress();
  console.log("PaymentSplitter deployed to:", paymentSplitterAddress);

  // Update IdentityNFT with new contract addresses
  console.log("\nUpdating IdentityNFT with new contract addresses...");
  const identityNFT = await ethers.getContractAt("IdentityNFT", deployment.contracts.IdentityNFT);
  
  const setTimelineTx = await identityNFT.setTimelineContract(timelineAddress);
  await setTimelineTx.wait();
  console.log("Timeline contract set in IdentityNFT");

  const setPaymentSplitterTx = await identityNFT.setPaymentSplitter(paymentSplitterAddress);
  await setPaymentSplitterTx.wait();
  console.log("PaymentSplitter contract set in IdentityNFT");

  // Update deployment file
  deployment.contracts.Timeline = timelineAddress;
  deployment.contracts.PaymentSplitter = paymentSplitterAddress;
  deployment.phase2DeployedAt = new Date().toISOString();

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("\nDeployment file updated");

  // Print summary
  console.log("\n=== Phase 2 Deployment Summary ===");
  console.log("Timeline:", timelineAddress);
  console.log("PaymentSplitter:", paymentSplitterAddress);
  console.log("IdentityNFT (updated):", deployment.contracts.IdentityNFT);
  console.log("\nPhase 2 deployment complete!");

  // Print verification commands
  console.log("\n=== Verification Commands ===");
  console.log(`npx hardhat verify --network amoy ${timelineAddress}`);
  console.log(`npx hardhat verify --network amoy ${paymentSplitterAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
