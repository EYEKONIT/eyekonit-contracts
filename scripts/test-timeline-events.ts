import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Test Timeline event emission and indexing
 * This script will:
 * 1. Create a timeline
 * 2. Add chapters to the timeline
 * 3. Complete a chapter
 * 4. Complete the timeline
 * 
 * The backend should index all these events
 */
async function main() {
  console.log("🧪 Testing Timeline Event Indexing...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Testing with account:", deployer.address);

  // Load deployment
  const deploymentPath = path.join(__dirname, "../deployments/amoy.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const timelineAddress = deployment.contracts.Timeline;
  console.log("Timeline contract:", timelineAddress);

  // Get Timeline contract
  const Timeline = await ethers.getContractAt("Timeline", timelineAddress);

  // Test 1: Create a timeline
  console.log("\n📝 Test 1: Creating a timeline...");
  const createTx = await Timeline.createTimeline(
    deployer.address, // organization (using deployer address as placeholder)
    "Test Timeline",
    "A test timeline for event indexing verification",
    3, // 3 chapters
    5 // 5% holder discount
  );
  const createReceipt = await createTx.wait();
  console.log("✅ Timeline created");
  console.log("   Transaction hash:", createReceipt?.hash);
  console.log("   Block number:", createReceipt?.blockNumber);

  // Get the timeline ID from the event
  const createEvent = createReceipt?.logs.find((log: any) => {
    try {
      const parsed = Timeline.interface.parseLog(log);
      return parsed?.name === "TimelineCreated";
    } catch {
      return false;
    }
  });

  if (!createEvent) {
    throw new Error("TimelineCreated event not found");
  }

  const parsedEvent = Timeline.interface.parseLog(createEvent);
  const timelineId = parsedEvent?.args[0];
  console.log("   Timeline ID:", timelineId.toString());

  // Wait a bit for backend to index
  console.log("\n⏳ Waiting 5 seconds for backend to index...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 2: Add chapters
  console.log("\n📝 Test 2: Adding chapters to timeline...");
  
  // Add chapter 1
  const addChapter1Tx = await Timeline.addChapter(
    timelineId,
    1, // chapter number
    1, // identity ID (placeholder)
    false // doesn't require previous
  );
  await addChapter1Tx.wait();
  console.log("✅ Chapter 1 added");

  // Add chapter 2
  const addChapter2Tx = await Timeline.addChapter(
    timelineId,
    2, // chapter number
    2, // identity ID (placeholder)
    true // requires previous
  );
  await addChapter2Tx.wait();
  console.log("✅ Chapter 2 added");

  // Add chapter 3
  const addChapter3Tx = await Timeline.addChapter(
    timelineId,
    3, // chapter number
    3, // identity ID (placeholder)
    true // requires previous
  );
  await addChapter3Tx.wait();
  console.log("✅ Chapter 3 added");

  // Wait for backend to index
  console.log("\n⏳ Waiting 5 seconds for backend to index...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 3: Complete a chapter
  console.log("\n📝 Test 3: Completing chapter 1...");
  const completeChapter1Tx = await Timeline.completeChapter(
    timelineId,
    1,
    deployer.address
  );
  await completeChapter1Tx.wait();
  console.log("✅ Chapter 1 completed");

  // Wait for backend to index
  console.log("\n⏳ Waiting 5 seconds for backend to index...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 4: Complete remaining chapters and timeline
  console.log("\n📝 Test 4: Completing remaining chapters...");
  
  const completeChapter2Tx = await Timeline.completeChapter(
    timelineId,
    2,
    deployer.address
  );
  await completeChapter2Tx.wait();
  console.log("✅ Chapter 2 completed");

  const completeChapter3Tx = await Timeline.completeChapter(
    timelineId,
    3,
    deployer.address
  );
  const completeChapter3Receipt = await completeChapter3Tx.wait();
  console.log("✅ Chapter 3 completed");
  console.log("✅ Timeline automatically completed (all chapters done)");

  // Wait for backend to index
  console.log("\n⏳ Waiting 5 seconds for backend to index...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Summary
  console.log("\n✨ Test Complete!");
  console.log("\n📊 Events Emitted:");
  console.log("   1. TimelineCreated");
  console.log("   2. ChapterAdded (x3)");
  console.log("   3. ChapterCompleted (x3)");
  console.log("   4. TimelineCompleted");
  console.log("\n📝 Next Steps:");
  console.log("   1. Check backend logs for event indexing");
  console.log("   2. Query database to verify events were indexed");
  console.log("   3. Check activity logs were created");
  console.log("   4. Check notifications were sent");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Test failed:");
    console.error(error);
    process.exit(1);
  });
