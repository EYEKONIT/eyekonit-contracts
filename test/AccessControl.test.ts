import { expect } from "chai";
import { ethers } from "hardhat";
import { EyekonAccessControl } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("EyekonAccessControl", function () {
  let accessControl: EyekonAccessControl;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();
    
    const AccessControl = await ethers.getContractFactory("EyekonAccessControl");
    accessControl = await AccessControl.deploy();
    await accessControl.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the deployer as admin", async function () {
      const ADMIN_ROLE = await accessControl.ADMIN_ROLE();
      expect(await accessControl.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should have correct role constants", async function () {
      expect(await accessControl.ADMIN_ROLE()).to.equal(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")));
      expect(await accessControl.MINTER_ROLE()).to.equal(ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")));
      expect(await accessControl.ISSUER_ROLE()).to.equal(ethers.keccak256(ethers.toUtf8Bytes("ISSUER_ROLE")));
    });
  });

  describe("Organization Registration", function () {
    it("Should register a new organization", async function () {
      const tx = await accessControl.connect(user1).registerOrganization("Test Org");
      await tx.wait();

      const org = await accessControl.getOrganization(1);
      expect(org.id).to.equal(1);
      expect(org.owner).to.equal(user1.address);
      expect(org.name).to.equal("Test Org");
      expect(org.isActive).to.be.true;
    });

    it("Should emit OrganizationRegistered event", async function () {
      await expect(accessControl.connect(user1).registerOrganization("Test Org"))
        .to.emit(accessControl, "OrganizationRegistered")
        .withArgs(1, user1.address, "Test Org");
    });

    it("Should grant owner roles to organization creator", async function () {
      await accessControl.connect(user1).registerOrganization("Test Org");
      
      const ORG_OWNER_ROLE = await accessControl.ORG_OWNER_ROLE();
      const MINTER_ROLE = await accessControl.MINTER_ROLE();
      const ISSUER_ROLE = await accessControl.ISSUER_ROLE();
      
      expect(await accessControl.hasRole(ORG_OWNER_ROLE, user1.address)).to.be.true;
      expect(await accessControl.hasRole(MINTER_ROLE, user1.address)).to.be.true;
      expect(await accessControl.hasRole(ISSUER_ROLE, user1.address)).to.be.true;
    });

    it("Should track user organizations", async function () {
      await accessControl.connect(user1).registerOrganization("Org 1");
      await accessControl.connect(user1).registerOrganization("Org 2");
      
      const userOrgs = await accessControl.getUserOrganizations(user1.address);
      expect(userOrgs.length).to.equal(2);
      expect(userOrgs[0]).to.equal(1);
      expect(userOrgs[1]).to.equal(2);
    });

    it("Should increment organization counter", async function () {
      await accessControl.connect(user1).registerOrganization("Org 1");
      await accessControl.connect(user2).registerOrganization("Org 2");
      
      expect(await accessControl.getTotalOrganizations()).to.equal(2);
    });
  });

  describe("Member Management", function () {
    beforeEach(async function () {
      await accessControl.connect(user1).registerOrganization("Test Org");
    });

    it("Should add a member with admin role", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE);
      
      const role = await accessControl.getMemberRole(1, user2.address);
      expect(role).to.equal(ORG_ADMIN_ROLE);
      
      expect(await accessControl.isOrganizationMember(1, user2.address)).to.be.true;
    });

    it("Should add a member with member role", async function () {
      const ORG_MEMBER_ROLE = await accessControl.ORG_MEMBER_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_MEMBER_ROLE);
      
      const role = await accessControl.getMemberRole(1, user2.address);
      expect(role).to.equal(ORG_MEMBER_ROLE);
    });

    it("Should grant platform roles to admin members", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      const MINTER_ROLE = await accessControl.MINTER_ROLE();
      const ISSUER_ROLE = await accessControl.ISSUER_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE);
      
      expect(await accessControl.hasRole(MINTER_ROLE, user2.address)).to.be.true;
      expect(await accessControl.hasRole(ISSUER_ROLE, user2.address)).to.be.true;
    });

    it("Should not grant platform roles to regular members", async function () {
      const ORG_MEMBER_ROLE = await accessControl.ORG_MEMBER_ROLE();
      const MINTER_ROLE = await accessControl.MINTER_ROLE();
      const ISSUER_ROLE = await accessControl.ISSUER_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_MEMBER_ROLE);
      
      expect(await accessControl.hasRole(MINTER_ROLE, user2.address)).to.be.false;
      expect(await accessControl.hasRole(ISSUER_ROLE, user2.address)).to.be.false;
    });

    it("Should emit MemberAdded event", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      
      await expect(accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE))
        .to.emit(accessControl, "MemberAdded")
        .withArgs(1, user2.address, ORG_ADMIN_ROLE);
    });

    it("Should revert if non-owner tries to add member", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      
      await expect(
        accessControl.connect(user2).addOrganizationMember(1, user3.address, ORG_ADMIN_ROLE)
      ).to.be.revertedWith("Only owner or admin can add members");
    });

    it("Should revert if adding duplicate member", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE);
      
      await expect(
        accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE)
      ).to.be.revertedWith("Member already exists");
    });

    it("Should remove a member", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE);
      await accessControl.connect(user1).removeOrganizationMember(1, user2.address);
      
      expect(await accessControl.isOrganizationMember(1, user2.address)).to.be.false;
    });

    it("Should emit MemberRemoved event", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE);
      
      await expect(accessControl.connect(user1).removeOrganizationMember(1, user2.address))
        .to.emit(accessControl, "MemberRemoved")
        .withArgs(1, user2.address);
    });

    it("Should revert if non-owner tries to remove member", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE);
      
      await expect(
        accessControl.connect(user2).removeOrganizationMember(1, user2.address)
      ).to.be.revertedWith("Only owner can remove members");
    });

    it("Should revert if trying to remove owner", async function () {
      await expect(
        accessControl.connect(user1).removeOrganizationMember(1, user1.address)
      ).to.be.revertedWith("Cannot remove owner");
    });

    it("Should update member role", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      const ORG_MEMBER_ROLE = await accessControl.ORG_MEMBER_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE);
      await accessControl.connect(user1).updateMemberRole(1, user2.address, ORG_MEMBER_ROLE);
      
      const role = await accessControl.getMemberRole(1, user2.address);
      expect(role).to.equal(ORG_MEMBER_ROLE);
    });

    it("Should emit MemberRoleUpdated event", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      const ORG_MEMBER_ROLE = await accessControl.ORG_MEMBER_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE);
      
      await expect(accessControl.connect(user1).updateMemberRole(1, user2.address, ORG_MEMBER_ROLE))
        .to.emit(accessControl, "MemberRoleUpdated")
        .withArgs(1, user2.address, ORG_MEMBER_ROLE);
    });

    it("Should revoke platform roles when downgrading from admin", async function () {
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      const ORG_MEMBER_ROLE = await accessControl.ORG_MEMBER_ROLE();
      const MINTER_ROLE = await accessControl.MINTER_ROLE();
      const ISSUER_ROLE = await accessControl.ISSUER_ROLE();
      
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE);
      await accessControl.connect(user1).updateMemberRole(1, user2.address, ORG_MEMBER_ROLE);
      
      expect(await accessControl.hasRole(MINTER_ROLE, user2.address)).to.be.false;
      expect(await accessControl.hasRole(ISSUER_ROLE, user2.address)).to.be.false;
    });
  });

  describe("Permission Checks", function () {
    beforeEach(async function () {
      await accessControl.connect(user1).registerOrganization("Test Org");
    });

    it("Should return true for canMintIdentity for organization owner", async function () {
      expect(await accessControl.canMintIdentity(user1.address)).to.be.true;
    });

    it("Should return true for canIssueCredential for organization owner", async function () {
      expect(await accessControl.canIssueCredential(user1.address)).to.be.true;
    });

    it("Should return false for canMintIdentity for non-member", async function () {
      expect(await accessControl.canMintIdentity(user2.address)).to.be.false;
    });

    it("Should return false for canIssueCredential for non-member", async function () {
      expect(await accessControl.canIssueCredential(user2.address)).to.be.false;
    });

    it("Should return true for admin role", async function () {
      expect(await accessControl.canMintIdentity(owner.address)).to.be.true;
      expect(await accessControl.canIssueCredential(owner.address)).to.be.true;
    });
  });

  describe("Query Functions", function () {
    beforeEach(async function () {
      await accessControl.connect(user1).registerOrganization("Test Org");
      const ORG_ADMIN_ROLE = await accessControl.ORG_ADMIN_ROLE();
      await accessControl.connect(user1).addOrganizationMember(1, user2.address, ORG_ADMIN_ROLE);
    });

    it("Should get organization members", async function () {
      const members = await accessControl.getOrganizationMembers(1);
      expect(members.length).to.equal(2);
      expect(members).to.include(user1.address);
      expect(members).to.include(user2.address);
    });

    it("Should get user organizations", async function () {
      await accessControl.connect(user1).registerOrganization("Org 2");
      
      const orgs = await accessControl.getUserOrganizations(user1.address);
      expect(orgs.length).to.equal(2);
    });

    it("Should get member role", async function () {
      const ORG_OWNER_ROLE = await accessControl.ORG_OWNER_ROLE();
      const role = await accessControl.getMemberRole(1, user1.address);
      expect(role).to.equal(ORG_OWNER_ROLE);
    });

    it("Should check if address is organization member", async function () {
      expect(await accessControl.isOrganizationMember(1, user1.address)).to.be.true;
      expect(await accessControl.isOrganizationMember(1, user2.address)).to.be.true;
      expect(await accessControl.isOrganizationMember(1, user3.address)).to.be.false;
    });
  });
});
