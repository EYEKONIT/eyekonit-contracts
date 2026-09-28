import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  if (network.config.chainId !== 80002) {
    throw new Error("The V2 launch deployment is currently restricted to Polygon Amoy (80002)");
  }

  const [deployer] = await ethers.getSigners();
  const platformAdmin = process.env.PLATFORM_ADMIN_ADDRESS;
  if (!platformAdmin || !ethers.isAddress(platformAdmin)) {
    throw new Error("PLATFORM_ADMIN_ADDRESS must be a valid dedicated admin or Safe address");
  }

  console.log("Deploying EYEKON V2 user-owned contracts");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Platform admin:", platformAdmin);

  const access = await (await ethers.getContractFactory("EyekonAccessControl")).deploy();
  await access.waitForDeployment();

  const identity = await (await ethers.getContractFactory("IdentityNFTV2")).deploy(
    await access.getAddress(),
  );
  await identity.waitForDeployment();

  const timeline = await (await ethers.getContractFactory("TimelineV2")).deploy(
    await access.getAddress(),
  );
  await timeline.waitForDeployment();

  const credential = await (
    await ethers.getContractFactory("CredentialRegistryV2")
  ).deploy(await access.getAddress());
  await credential.waitForDeployment();

  const payment = await (await ethers.getContractFactory("PaymentSplitterV2")).deploy(
    await identity.getAddress(),
  );
  await payment.waitForDeployment();

  await (await identity.setTimelineContract(await timeline.getAddress())).wait();
  await (await identity.setPaymentSplitter(await payment.getAddress())).wait();
  await (await timeline.setIdentityContract(await identity.getAddress())).wait();

  if (platformAdmin.toLowerCase() !== deployer.address.toLowerCase()) {
    const defaultAdminRole = await access.DEFAULT_ADMIN_ROLE();
    const adminRole = await access.ADMIN_ROLE();
    await (await access.grantRole(defaultAdminRole, platformAdmin)).wait();
    await (await access.grantRole(adminRole, platformAdmin)).wait();
    await (await identity.transferOwnership(platformAdmin)).wait();
    await (await timeline.transferOwnership(platformAdmin)).wait();
    await (await access.renounceRole(adminRole, deployer.address)).wait();
    await (await access.renounceRole(defaultAdminRole, deployer.address)).wait();
  }

  const addresses = {
    AccessControl: await access.getAddress(),
    IdentityNFT: await identity.getAddress(),
    Timeline: await timeline.getAddress(),
    CredentialRegistry: await credential.getAddress(),
    PaymentSplitter: await payment.getAddress(),
  };
  const deployment = {
    version: 2,
    network: network.name,
    chainId: 80002,
    deployer: deployer.address,
    platformAdmin,
    timestamp: new Date().toISOString(),
    contracts: addresses,
  };

  const outputPath = path.join(__dirname, "..", "deployments", "amoy-v2.json");
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
