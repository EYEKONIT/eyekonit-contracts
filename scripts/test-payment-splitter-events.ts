import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Test PaymentSplitter event emission and indexing
 * This script will:
 * 1. Configure royalty for an identity
 * 2. Process a primary sale payment
 * 3. Process a secondary sale payment
 * 4. Withdraw earnings
 * 
 * The backend should index all these events
 */
async function main() {
  console.log("🧪 Testing PaymentSplitter Event Indexing...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Testing with account:", deployer.address);
  
  // For testing, we'll use two different addresses (deployer and a generated address)
  const recipient1 = deployer;
  const recipient2Address = ethers.getAddress("0x742d35cc6634c0532925a3b844bc9e7595f0beb1"); // Test address with proper checksum
  
  console.log("Recipient 1:", recipient1.address);
  console.log("Recipient 2:", recipient2Address);

  // Load deployment
  const deploymentPath = path.join(__dirname, "../deployments/amoy.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const paymentSplitterAddress = deployment.contracts.PaymentSplitter;
  console.log("PaymentSplitter contract:", paymentSplitterAddress);

  // Get PaymentSplitter contract
  const PaymentSplitter = await ethers.getContractAt("PaymentSplitter", paymentSplitterAddress);

  const testIdentityId = 999; // Using a test identity ID

  // Test 1: Configure royalty
  console.log("\n📝 Test 1: Configuring royalty for identity...");
  const configureTx = await PaymentSplitter.configureRoyalty(
    testIdentityId,
    500, // 5% royalty (500 basis points)
    [recipient1.address, recipient2Address],
    [7000, 3000] // 70% to recipient1, 30% to recipient2
  );
  const configureReceipt = await configureTx.wait();
  console.log("✅ Royalty configured");
  console.log("   Transaction hash:", configureReceipt?.hash);
  console.log("   Block number:", configureReceipt?.blockNumber);
  console.log("   Identity ID:", testIdentityId);
  console.log("   Royalty: 5%");
  console.log("   Split: 70% / 30%");

  // Wait for backend to index
  console.log("\n⏳ Waiting 5 seconds for backend to index...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 2: Process primary sale
  console.log("\n📝 Test 2: Processing primary sale payment...");
  const primarySaleAmount = ethers.parseEther("0.1"); // 0.1 MATIC
  const primarySaleTx = await PaymentSplitter.processPrimarySale(
    testIdentityId,
    { value: primarySaleAmount }
  );
  const primarySaleReceipt = await primarySaleTx.wait();
  console.log("✅ Primary sale processed");
  console.log("   Transaction hash:", primarySaleReceipt?.hash);
  console.log("   Amount:", ethers.formatEther(primarySaleAmount), "MATIC");
  console.log("   Recipient 1 gets:", ethers.formatEther(primarySaleAmount * BigInt(7000) / BigInt(10000)), "MATIC");
  console.log("   Recipient 2 gets:", ethers.formatEther(primarySaleAmount * BigInt(3000) / BigInt(10000)), "MATIC");

  // Wait for backend to index
  console.log("\n⏳ Waiting 5 seconds for backend to index...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 3: Process secondary sale
  console.log("\n📝 Test 3: Processing secondary sale payment...");
  const secondarySalePrice = ethers.parseEther("0.2"); // 0.2 MATIC sale price
  const royaltyAmount = secondarySalePrice * BigInt(500) / BigInt(10000); // 5% royalty
  const secondarySaleTx = await PaymentSplitter.processSecondarySale(
    testIdentityId,
    secondarySalePrice,
    { value: royaltyAmount }
  );
  const secondarySaleReceipt = await secondarySaleTx.wait();
  console.log("✅ Secondary sale processed");
  console.log("   Transaction hash:", secondarySaleReceipt?.hash);
  console.log("   Sale price:", ethers.formatEther(secondarySalePrice), "MATIC");
  console.log("   Royalty amount:", ethers.formatEther(royaltyAmount), "MATIC");
  console.log("   Recipient 1 gets:", ethers.formatEther(royaltyAmount * BigInt(7000) / BigInt(10000)), "MATIC");
  console.log("   Recipient 2 gets:", ethers.formatEther(royaltyAmount * BigInt(3000) / BigInt(10000)), "MATIC");

  // Wait for backend to index
  console.log("\n⏳ Waiting 5 seconds for backend to index...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 4: Withdraw earnings (recipient 1)
  console.log("\n📝 Test 4: Withdrawing earnings (recipient 1)...");
  const pendingAmount1 = await PaymentSplitter.getPendingWithdrawal(testIdentityId, recipient1.address);
  console.log("   Pending withdrawal:", ethers.formatEther(pendingAmount1), "MATIC");
  
  const withdrawTx1 = await PaymentSplitter.connect(recipient1).withdraw(testIdentityId);
  const withdrawReceipt1 = await withdrawTx1.wait();
  console.log("✅ Withdrawal completed (recipient 1)");
  console.log("   Transaction hash:", withdrawReceipt1?.hash);
  console.log("   Amount:", ethers.formatEther(pendingAmount1), "MATIC");

  // Wait for backend to index
  console.log("\n⏳ Waiting 5 seconds for backend to index...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 5: Check pending withdrawal for recipient 2 (can't withdraw as we don't have the key)
  console.log("\n📝 Test 5: Checking pending withdrawal (recipient 2)...");
  const pendingAmount2 = await PaymentSplitter.getPendingWithdrawal(testIdentityId, recipient2Address);
  console.log("✅ Pending withdrawal checked (recipient 2)");
  console.log("   Pending amount:", ethers.formatEther(pendingAmount2), "MATIC");
  console.log("   Note: Cannot withdraw as we don't have the private key for this test address");

  // Wait for backend to index
  console.log("\n⏳ Waiting 5 seconds for backend to index...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Summary
  console.log("\n✨ Test Complete!");
  console.log("\n📊 Events Emitted:");
  console.log("   1. RoyaltyConfigured");
  console.log("   2. PaymentReceived (primary sale)");
  console.log("   3. PaymentSplit (x2 for primary sale)");
  console.log("   4. PaymentReceived (secondary sale)");
  console.log("   5. PaymentSplit (x2 for secondary sale)");
  console.log("   6. Withdrawal (recipient 1)");
  console.log("\n📝 Total Events: 8");
  console.log("\n📝 Next Steps:");
  console.log("   1. Check backend logs for event indexing");
  console.log("   2. Query database to verify events were indexed");
  console.log("   3. Check activity logs were created");
  console.log("   4. Check earnings are tracked correctly");
  console.log("   5. Check notifications were sent");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Test failed:");
    console.error(error);
    process.exit(1);
  });
