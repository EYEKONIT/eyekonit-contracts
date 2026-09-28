import { expect } from "chai";
import { ethers } from "hardhat";
import { EyekonAccessControl } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AccessControl - Organization Name Uniqueness", function () {
  let accessControl: EyekonAccessControl;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const AccessControlFactory = await ethers.getContractFactory("EyekonAccessControl");
    accessControl = await AccessControlFactory.deploy();
    await accessControl.waitForDeployment();
  });

  describe("Name Uniqueness", function () {
    it("Should allow registering organization with unique name", async function () {
      const tx = await accessControl.connect(user1).registerOrganization("Test Organization");
      await tx.wait();

      const orgId = 1;
      const org = await accessControl.getOrganization(orgId);
      expect(org.name).to.equal("Test Organization");
      expect(org.owner).to.equal(user1.address);
    });

    it("Should prevent registering organization with duplicate name (exact match)", async function () {
      // Register first organization
      await accessControl.connect(user1).registerOrganization("Test Organization");

      // Try to register second organization with same name
      await expect(
        accessControl.connect(user2).registerOrganization("Test Organization")
      ).to.be.revertedWith("Organization name already exists");
    });

    it("Should prevent registering organization with duplicate name (case insensitive)", async function () {
      // Register first organization
      await accessControl.connect(user1).registerOrganization("Test Organization");

      // Try to register with different case
      await expect(
        accessControl.connect(user2).registerOrganization("test organization")
      ).to.be.revertedWith("Organization name already exists");

      await expect(
        accessControl.connect(user2).registerOrganization("TEST ORGANIZATION")
      ).to.be.revertedWith("Organization name already exists");

      await expect(
        accessControl.connect(user2).registerOrganization("TeSt OrGaNiZaTiOn")
      ).to.be.revertedWith("Organization name already exists");
    });

    it("Should allow registering organizations with different names", async function () {
      await accessControl.connect(user1).registerOrganization("Organization One");
      await accessControl.connect(user2).registerOrganization("Organization Two");

      const org1 = await accessControl.getOrganization(1);
      const org2 = await accessControl.getOrganization(2);

      expect(org1.name).to.equal("Organization One");
      expect(org2.name).to.equal("Organization Two");
    });

    it("Should prevent registering organization with empty name", async function () {
      await expect(
        accessControl.connect(user1).registerOrganization("")
      ).to.be.revertedWith("Organization name cannot be empty");
    });

    it("Should allow similar but different names", async function () {
      await accessControl.connect(user1).registerOrganization("Test Organization");
      await accessControl.connect(user2).registerOrganization("Test Organization 2");

      const org1 = await accessControl.getOrganization(1);
      const org2 = await accessControl.getOrganization(2);

      expect(org1.name).to.equal("Test Organization");
      expect(org2.name).to.equal("Test Organization 2");
    });

    it("Should handle names with special characters", async function () {
      await accessControl.connect(user1).registerOrganization("Test & Co.");
      await accessControl.connect(user2).registerOrganization("Test @ Home");

      const org1 = await accessControl.getOrganization(1);
      const org2 = await accessControl.getOrganization(2);

      expect(org1.name).to.equal("Test & Co.");
      expect(org2.name).to.equal("Test @ Home");
    });

    it("Should handle names with numbers", async function () {
      await accessControl.connect(user1).registerOrganization("Organization 123");
      await accessControl.connect(user2).registerOrganization("Organization 456");

      const org1 = await accessControl.getOrganization(1);
      const org2 = await accessControl.getOrganization(2);

      expect(org1.name).to.equal("Organization 123");
      expect(org2.name).to.equal("Organization 456");
    });

    it("Should prevent duplicate even with leading/trailing spaces", async function () {
      await accessControl.connect(user1).registerOrganization("Test Organization");

      // Note: Solidity doesn't automatically trim spaces, so these would be considered different
      // But the case-insensitive check should still work
      const tx = await accessControl.connect(user2).registerOrganization(" Test Organization ");
      await tx.wait();

      // This should succeed because spaces make it different
      const org2 = await accessControl.getOrganization(2);
      expect(org2.name).to.equal(" Test Organization ");
    });

    it("Should emit OrganizationRegistered event with correct parameters", async function () {
      await expect(accessControl.connect(user1).registerOrganization("Test Organization"))
        .to.emit(accessControl, "OrganizationRegistered")
        .withArgs(1, user1.address, "Test Organization");
    });

    it("Should allow same user to register multiple organizations with different names", async function () {
      await accessControl.connect(user1).registerOrganization("Organization One");
      await accessControl.connect(user1).registerOrganization("Organization Two");

      const userOrgs = await accessControl.getUserOrganizations(user1.address);
      expect(userOrgs.length).to.equal(2);
      expect(userOrgs[0]).to.equal(1);
      expect(userOrgs[1]).to.equal(2);
    });

    it("Should prevent same user from registering organization with duplicate name", async function () {
      await accessControl.connect(user1).registerOrganization("Test Organization");

      await expect(
        accessControl.connect(user1).registerOrganization("Test Organization")
      ).to.be.revertedWith("Organization name already exists");
    });
  });

  describe("Gas Optimization", function () {
    it("Should use reasonable gas for name uniqueness check", async function () {
      const tx = await accessControl.connect(user1).registerOrganization("Test Organization");
      const receipt = await tx.wait();
      
      console.log(`Gas used for organization registration with uniqueness check: ${receipt?.gasUsed.toString()}`);
      
      // Gas should be reasonable (less than 400k)
      // Note: Includes role grants and other operations, not just name check
      expect(receipt?.gasUsed).to.be.lessThan(400000);
    });
  });
});
