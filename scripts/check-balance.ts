import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Address:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "MATIC");
}

main().catch(console.error);
