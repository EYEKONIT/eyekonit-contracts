import { expect } from "chai";
import { ethers } from "hardhat";
import { EyekonAccessControl } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AccessControl - Ownership Transfer", function () {
  let accessControl: EyekonAccessControl;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    const AccessControlFactory = await ethers.getContractFactory("EyekonAccessControl");
    accessControl = await AccessControlFactory.deploy();
    await accessControl.waitForDeployment();
  });

  describe("Transfer Organization Ownership", function () {
    let orgId: bigint;
    let ORG_OWNER_ROLE: string;
    let ORG_ADMIN_ROLE: string;
    let ORG_MEMBER_ROLE: string;

    beforeEach(async function () {
      // Get role constants
      ORG_OWNER_ROLE = await accessControl.ORG_OWNER_ROLE();
      ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      ORG_MEMBER_ROLE = await accessControl.ORG_MEMBER_ROLE();

      // Register organization
      const tx = await accessControl.connect(user1).registerOrganization("Test Org");
      const receipt = await tx.wait();
      
      // Get orgId from event
      const event = receipt?.logs.find(
        (log: any) => {
          try {
            const parsed = accessControl.interface.parseLog({
              topics: log.topics as string[],
              data: log.data,
            });
            return parsed?.name === "OrganizationRegistered";
          } catch {
            return false;
          }
        }
      );
      
      if (event) {
        const parsed = accessControl.interface.parseLog({
          topics: event.topics as string[],
          data: event.data,
        });
        orgId = parsed?.args[0];
      }

      // Add user2 as admin member
      await accessControl.connect(user1).addOrganizationMember(
        orgId,
        user2.address,
        ORG_ADMIN_ROLE
      );
    });

    it("Should transfer ownership to existing member", async function () {
      // Transfer ownership from user1 to user2
      await accessControl.connect(user1).transferOrganizationOwnership(
        orgId,
        user2.address
      );

      // Check organization owner updated
      const org = await accessControl.organizations(orgId);
      expect(org.owner).to.equal(user2.address);

      // Check roles updated
      const oldOwnerRole = await accessControl.getMemberRole(orgId, user1.address);
      const newOwnerRole = await accessControl.getMemberRole(orgId, user2.address);
      
      expect(oldOwnerRole).to.equal(ORG_ADMIN_ROLE);
      expect(newOwnerRole).to.equal(ORG_OWNER_ROLE);
    });

    it("Should emit OwnershipTransferred event", async function () {
      await expect(
        accessControl.connect(user1).transferOrganizationOwnership(
          orgId,
          user2.address
        )
      )
        .to.emit(accessControl, "OwnershipTransferred")
        .withArgs(orgId, user1.address, user2.address);
    });

    it("Should grant platform roles to new owner", async function () {
      const MINTER_ROLE = await accessControl.MINTER_ROLE();
      const ISSUER_ROLE = await accessControl.ISSUER_ROLE();

      // Transfer ownership
      await accessControl.connect(user1).transferOrganizationOwnership(
        orgId,
        user2.address
      );

      // Check new owner has platform roles
      expect(await accessControl.hasRole(MINTER_ROLE, user2.address)).to.be.true;
      expect(await accessControl.hasRole(ISSUER_ROLE, user2.address)).to.be.true;
    });

    it("Should revoke platform roles from old owner if no other admin roles", async function () {
      const MINTER_ROLE = await accessControl.MINTER_ROLE();
      const ISSUER_ROLE = await accessControl.ISSUER_ROLE();

      // Verify old owner has roles
      expect(await accessControl.hasRole(MINTER_ROLE, user1.address)).to.be.true;
      expect(await accessControl.hasRole(ISSUER_ROLE, user1.address)).to.be.true;

      // Transfer ownership
      await accessControl.connect(user1).transferOrganizationOwnership(
        orgId,
        user2.address
      );

      // Check old owner roles revoked (since they have no other organizations)
      expect(await accessControl.hasRole(MINTER_ROLE, user1.address)).to.be.false;
      expect(await accessControl.hasRole(ISSUER_ROLE, user1.address)).to.be.false;
    });

    it("Should NOT revoke platform roles from old owner if they have other admin roles", async function () {
      const MINTER_ROLE = await accessControl.MINTER_ROLE();
      const ISSUER_ROLE = await accessControl.ISSUER_ROLE();

      // Create another organization for user1
      await accessControl.connect(user1).registerOrganization("Second Org");

      // Transfer ownership of first org
      await accessControl.connect(user1).transferOrganizationOwnership(
        orgId,
        user2.address
      );

      // Check old owner still has roles (because of second organization)
      expect(await accessControl.hasRole(MINTER_ROLE, user1.address)).to.be.true;
      expect(await accessControl.hasRole(ISSUER_ROLE, user1.address)).to.be.true;
    });

    it("Should revert if non-owner tries to transfer", async function () {
      await expect(
        accessControl.connect(user2).transferOrganizationOwnership(
          orgId,
          user3.address
        )
      ).to.be.revertedWith("Only current owner can transfer ownership");
    });

    it("Should revert if new owner is not a member", async function () {
      await expect(
        accessControl.connect(user1).transferOrganizationOwnership(
          orgId,
          user3.address
        )
      ).to.be.revertedWith("New owner must be a member");
    });

    it("Should revert if transferring to yourself", async function () {
      await expect(
        accessControl.connect(user1).transferOrganizationOwnership(
          orgId,
          user1.address
        )
      ).to.be.revertedWith("Cannot transfer to yourself");
    });

    it("Should revert if transferring to zero address", async function () {
      await expect(
        accessControl.connect(user1).transferOrganizationOwnership(
          orgId,
          ethers.ZeroAddress
        )
      ).to.be.revertedWith("Invalid new owner address");
    });

    it("Should revert if organization does not exist", async function () {
      await expect(
        accessControl.connect(user1).transferOrganizationOwnership(
          999,
          user2.address
        )
      ).to.be.revertedWith("Organization does not exist");
    });

    it("Should allow new owner to perform owner actions", async function () {
      // Transfer ownership
      await accessControl.connect(user1).transferOrganizationOwnership(
        orgId,
        user2.address
      );

      // New owner should be able to add members
      await expect(
        accessControl.connect(user2).addOrganizationMember(
          orgId,
          user3.address,
          ORG_MEMBER_ROLE
        )
      ).to.not.be.reverted;

      // Verify member was added
      const memberRole = await accessControl.getMemberRole(orgId, user3.address);
      expect(memberRole).to.equal(ORG_MEMBER_ROLE);
    });

    it("Should prevent old owner from performing owner actions", async function () {
      // Transfer ownership
      await accessControl.connect(user1).transferOrganizationOwnership(
        orgId,
        user2.address
      );

      // Old owner should NOT be able to add members (now admin, not owner)
      await expect(
        accessControl.connect(user1).addOrganizationMember(
          orgId,
          user3.address,
          ORG_MEMBER_ROLE
        )
      ).to.not.be.reverted; // Admin can still add members

      // But old owner should NOT be able to transfer ownership again
      await expect(
        accessControl.connect(user1).transferOrganizationOwnership(
          orgId,
          user3.address
        )
      ).to.be.revertedWith("Only current owner can transfer ownership");
    });

    it("Should handle multiple ownership transfers", async function () {
      // Add user3 as member
      await accessControl.connect(user1).addOrganizationMember(
        orgId,
        user3.address,
        ORG_MEMBER_ROLE
      );

      // First transfer: user1 -> user2
      await accessControl.connect(user1).transferOrganizationOwnership(
        orgId,
        user2.address
      );

      let org = await accessControl.organizations(orgId);
      expect(org.owner).to.equal(user2.address);

      // Second transfer: user2 -> user3
      await accessControl.connect(user2).transferOrganizationOwnership(
        orgId,
        user3.address
      );

      org = await accessControl.organizations(orgId);
      expect(org.owner).to.equal(user3.address);

      // Check final roles
      const user1Role = await accessControl.getMemberRole(orgId, user1.address);
      const user2Role = await accessControl.getMemberRole(orgId, user2.address);
      const user3Role = await accessControl.getMemberRole(orgId, user3.address);

      expect(user1Role).to.equal(ORG_ADMIN_ROLE);
      expect(user2Role).to.equal(ORG_ADMIN_ROLE);
      expect(user3Role).to.equal(ORG_OWNER_ROLE);
    });

    it("Should work with regular member (not admin) as new owner", async function () {
      // Add user3 as regular member
      await accessControl.connect(user1).addOrganizationMember(
        orgId,
        user3.address,
        ORG_MEMBER_ROLE
      );

      // Transfer ownership to regular member
      await accessControl.connect(user1).transferOrganizationOwnership(
        orgId,
        user3.address
      );

      // Check ownership transferred
      const org = await accessControl.organizations(orgId);
      expect(org.owner).to.equal(user3.address);

      // Check role upgraded to owner
      const user3Role = await accessControl.getMemberRole(orgId, user3.address);
      expect(user3Role).to.equal(ORG_OWNER_ROLE);
    });
  });

  describe("Gas Optimization", function () {
    it("Should use reasonable gas for ownership transfer", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();

      // Register organization
      const tx1 = await accessControl.connect(user1).registerOrganization("Gas Test Org");
      const receipt1 = await tx1.wait();
      
      const event = receipt1?.logs.find((log: any) => {
        try {
          const parsed = accessControl.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          return parsed?.name === "OrganizationRegistered";
        } catch {
          return false;
        }
      });
      
      let orgId: bigint = 0n;
      if (event) {
        const parsed = accessControl.interface.parseLog({
          topics: event.topics as string[],
          data: event.data,
        });
        orgId = parsed?.args[0];
      }

      // Add member
      await accessControl.connect(user1).addOrganizationMember(
        orgId,
        user2.address,
        ORG_ADMIN_ROLE
      );

      // Transfer ownership and measure gas
      const tx2 = await accessControl.connect(user1).transferOrganizationOwnership(
        orgId,
        user2.address
      );
      const receipt2 = await tx2.wait();
      
      const gasUsed = receipt2?.gasUsed || 0n;
      console.log(`Gas used for ownership transfer: ${gasUsed.toString()}`);

      // Should use less than 200k gas
      expect(gasUsed).to.be.lessThan(200000n);
    });
  });
});
