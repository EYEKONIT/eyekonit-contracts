import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🔍 Verifying EYEKON contracts on PolygonScan...\n");

  // Get network name
  const network = process.env.HARDHAT_NETWORK || "mumbai";
  
  // Load deployment addresses
  const deploymentFile = path.join(__dirname, "..", "deployments", `${network}.json`);
  
  if (!fs.existsSync(deploymentFile)) {
    console.error(`❌ Deployment file not found: ${deploymentFile}`);
    console.error("Please deploy contracts first using: npm run deploy:mumbai");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const { AccessControl, IdentityNFT, CredentialRegistry } = deployment.contracts;

  console.log("📋 Contract Addresses:");
  console.log("   AccessControl:", AccessControl);
  console.log("   IdentityNFT:", IdentityNFT);
  console.log("   CredentialRegistry:", CredentialRegistry);
  console.log();

  // Verify AccessControl
  try {
    console.log("🔍 Verifying AccessControl...");
    await run("verify:verify", {
      address: AccessControl,
      constructorArguments: [],
    });
    console.log("✅ AccessControl verified\n");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ AccessControl already verified\n");
    } else {
      console.error("❌ AccessControl verification failed:", error.message, "\n");
    }
  }

  // Verify IdentityNFT
  try {
    console.log("🔍 Verifying IdentityNFT...");
    await run("verify:verify", {
      address: IdentityNFT,
      constructorArguments: [AccessControl],
    });
    console.log("✅ IdentityNFT verified\n");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ IdentityNFT already verified\n");
    } else {
      console.error("❌ IdentityNFT verification failed:", error.message, "\n");
    }
  }

  // Verify CredentialRegistry
  try {
    console.log("🔍 Verifying CredentialRegistry...");
    await run("verify:verify", {
      address: CredentialRegistry,
      constructorArguments: [AccessControl],
    });
    console.log("✅ CredentialRegistry verified\n");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ CredentialRegistry already verified\n");
    } else {
      console.error("❌ CredentialRegistry verification failed:", error.message, "\n");
    }
  }

  console.log("✨ Verification complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Verification failed:");
    console.error(error);
    process.exit(1);
  });
