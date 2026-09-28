import { ethers } from "hardhat";
import type { Fragment } from "ethers";

async function main() {
  console.log("Verifying deployed AccessControl contract...\n");

  const accessControlAddress = "0x4b4948c485c7C3D1C24E7feA8e937909b36288f5";
  
  // Get contract instance
  const AccessControl = await ethers.getContractFactory("EyekonAccessControl");
  const accessControl = AccessControl.attach(accessControlAddress) as any;

  try {
    // Test 1: Check if contract exists
    const code = await ethers.provider.getCode(accessControlAddress);
    if (code === "0x") {
      console.log("❌ ERROR: No contract deployed at this address!");
      return;
    }
    console.log("✅ Contract exists at address");

    // Test 2: Try to call a view function
    try {
      const totalOrgs = await accessControl.getTotalOrganizations();
      console.log(`✅ getTotalOrganizations() works: ${totalOrgs} organizations`);
    } catch (error: any) {
      console.log(`❌ getTotalOrganizations() failed: ${error.message}`);
    }

    // Test 3: Check if transferOrganizationOwnership function exists
    try {
      // Try to get the function selector
      const iface = accessControl.interface;
      const fragment = iface.getFunction("transferOrganizationOwnership");
      console.log(`✅ transferOrganizationOwnership function exists`);
      console.log(`   Selector: ${fragment?.selector}`);
    } catch (error: any) {
      console.log(`❌ transferOrganizationOwnership function NOT FOUND`);
      console.log(`   This means the contract needs to be redeployed!`);
    }

    // Test 4: List all available functions
    console.log("\n📋 Available functions:");
    const iface = accessControl.interface;
    iface.fragments
      .filter((fragment: Fragment) => fragment.type === "function")
      .forEach((fragment: Fragment) => console.log(`   - ${fragment.format()}`));

  } catch (error: any) {
    console.error("Error:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
