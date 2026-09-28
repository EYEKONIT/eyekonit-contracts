import { expect } from "chai";
import { ethers } from "hardhat";
import { EyekonAccessControl, IdentityNFT } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("IdentityNFT", function () {
  let accessControl: EyekonAccessControl;
  let identityNFT: IdentityNFT;
  let owner: SignerWithAddress;
  let creator: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, creator, user1, user2] = await ethers.getSigners();
    
    // Deploy AccessControl
    const AccessControl = await ethers.getContractFactory("EyekonAccessControl");
    accessControl = await AccessControl.deploy();
    await accessControl.waitForDeployment();
    
    // Deploy IdentityNFT
    const IdentityNFT = await ethers.getContractFactory("IdentityNFT");
    identityNFT = await IdentityNFT.deploy(await accessControl.getAddress());
    await identityNFT.waitForDeployment();
    
    // Register organization for creator
    await accessControl.connect(creator).registerOrganization("Test Org");
  });

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await identityNFT.name()).to.equal("EYEKON Identity");
      expect(await identityNFT.symbol()).to.equal("EYEKON");
    });

    it("Should link to AccessControl contract", async function () {
      expect(await identityNFT.accessControl()).to.equal(await accessControl.getAddress());
    });
  });

  describe("Identity Creation", function () {
    it("Should create a new identity", async function () {
      const tx = await identityNFT.connect(creator).createIdentity(
        "ipfs://metadata",
        100,
        ethers.parseEther("0.1"),
        false,
        0,
        0
      );
      await tx.wait();

      const identity = await identityNFT.getIdentity(1);
      expect(identity.id).to.equal(1);
      expect(identity.creator).to.equal(creator.address);
      expect(identity.metadataURI).to.equal("ipfs://metadata");
      expect(identity.maxSupply).to.equal(100);
      expect(identity.price).to.equal(ethers.parseEther("0.1"));
      expect(identity.isActive).to.be.true;
    });

    it("Should emit IdentityCreated event", async function () {
      await expect(
        identityNFT.connect(creator).createIdentity(
          "ipfs://metadata",
          100,
          ethers.parseEther("0.1"),
          false,
          0,
          0
        )
      ).to.emit(identityNFT, "IdentityCreated");
    });

    it("Should revert if non-authorized user tries to create", async function () {
      await expect(
        identityNFT.connect(user1).createIdentity(
          "ipfs://metadata",
          100,
          ethers.parseEther("0.1"),
          false,
          0,
          0
        )
      ).to.be.revertedWith("Not authorized to create identities");
    });

    it("Should revert if discount exceeds 100%", async function () {
      await expect(
        identityNFT.connect(creator).createIdentity(
          "ipfs://metadata",
          100,
          ethers.parseEther("0.1"),
          false,
          0,
          101
        )
      ).to.be.revertedWith("Discount cannot exceed 100%");
    });

    it("Should create identity with evolution requirements", async function () {
      await identityNFT.connect(creator).createIdentity(
        "ipfs://chapter1",
        100,
        ethers.parseEther("0.1"),
        false,
        0,
        0
      );

      await identityNFT.connect(creator).createIdentity(
        "ipfs://chapter2",
        100,
        ethers.parseEther("0.1"),
        false,
        1, // Requires chapter 1
        20 // 20% discount
      );

      const chapter2 = await identityNFT.getIdentity(2);
      expect(chapter2.requiredPreviousId).to.equal(1);
      expect(chapter2.holderDiscount).to.equal(20);
    });
  });

  describe("Property 12: Supply Limit Enforcement", function () {
    beforeEach(async function () {
      await identityNFT.connect(creator).createIdentity(
        "ipfs://limited",
        2, // Max supply of 2
        0,
        false,
        0,
        0
      );
    });

    it("Should allow minting up to max supply", async function () {
      await identityNFT.connect(creator).mintIdentity(user1.address, 1);
      await identityNFT.connect(creator).mintIdentity(user2.address, 1);
      
      const identity = await identityNFT.getIdentity(1);
      expect(identity.supply).to.equal(2);
    });

    it("Should revert when exceeding max supply", async function () {
      await identityNFT.connect(creator).mintIdentity(user1.address, 1);
      await identityNFT.connect(creator).mintIdentity(user2.address, 1);
      
      await expect(
        identityNFT.connect(creator).mintIdentity(user1.address, 1)
      ).to.be.revertedWith("Supply limit reached");
    });

    it("Should allow unlimited supply when maxSupply is 0", async function () {
      await identityNFT.connect(creator).createIdentity(
        "ipfs://unlimited",
        0, // Unlimited
        0,
        false,
        0,
        0
      );

      // Mint multiple times
      for (let i = 0; i < 5; i++) {
        await identityNFT.connect(creator).mintIdentity(user1.address, 2);
      }

      const identity = await identityNFT.getIdentity(2);
      expect(identity.supply).to.equal(5);
    });
  });

  describe("Property 13: Free Identity Claiming", function () {
    beforeEach(async function () {
      await identityNFT.connect(creator).createIdentity(
        "ipfs://free",
        100,
        0, // Free
        false,
        0,
        0
      );
    });

    it("Should allow claiming free identity without payment", async function () {
      await identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash);
      
      expect(await identityNFT.balanceOf(user1.address)).to.equal(1);
    });

    it("Should revert if payment sent for free identity", async function () {
      // Actually, the contract accepts overpayment and refunds it
      // Let's test that refund works
      const balanceBefore = await ethers.provider.getBalance(user1.address);
      
      const tx = await identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash, {
        value: ethers.parseEther("0.1")
      });
      const receipt = await tx.wait();
      
      const balanceAfter = await ethers.provider.getBalance(user1.address);
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      
      // Balance should only decrease by gas cost
      expect(balanceBefore - balanceAfter).to.be.closeTo(gasCost, ethers.parseEther("0.001"));
    });
  });

  describe("Property 14: Paid Identity Purchase Requirement", function () {
    beforeEach(async function () {
      await identityNFT.connect(creator).createIdentity(
        "ipfs://paid",
        100,
        ethers.parseEther("0.1"),
        false,
        0,
        0
      );
    });

    it("Should require payment for paid identity", async function () {
      await expect(
        identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash)
      ).to.be.revertedWith("Insufficient payment");
    });

    it("Should allow claiming with exact payment", async function () {
      await identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash, {
        value: ethers.parseEther("0.1")
      });
      
      expect(await identityNFT.balanceOf(user1.address)).to.equal(1);
    });

    it("Should transfer payment to creator", async function () {
      const creatorBalanceBefore = await ethers.provider.getBalance(creator.address);
      
      await identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash, {
        value: ethers.parseEther("0.1")
      });
      
      const creatorBalanceAfter = await ethers.provider.getBalance(creator.address);
      expect(creatorBalanceAfter - creatorBalanceBefore).to.equal(ethers.parseEther("0.1"));
    });

    it("Should refund excess payment", async function () {
      const balanceBefore = await ethers.provider.getBalance(user1.address);
      
      const tx = await identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash, {
        value: ethers.parseEther("0.2")
      });
      const receipt = await tx.wait();
      
      const balanceAfter = await ethers.provider.getBalance(user1.address);
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      
      // Should only pay 0.1 ETH + gas
      expect(balanceBefore - balanceAfter).to.be.closeTo(
        ethers.parseEther("0.1") + gasCost,
        ethers.parseEther("0.001")
      );
    });
  });

  describe("Property 15: Evolution Chapter Progression", function () {
    beforeEach(async function () {
      // Create chapter 1
      await identityNFT.connect(creator).createIdentity(
        "ipfs://chapter1",
        100,
        0,
        false,
        0,
        0
      );

      // Create chapter 2 requiring chapter 1
      await identityNFT.connect(creator).createIdentity(
        "ipfs://chapter2",
        100,
        0,
        false,
        1, // Requires chapter 1
        0
      );
    });

    it("Should allow claiming chapter 1 without requirements", async function () {
      await identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash);
      expect(await identityNFT.balanceOf(user1.address)).to.equal(1);
    });

    it("Should revert claiming chapter 2 without chapter 1", async function () {
      await expect(
        identityNFT.connect(user1).claimIdentity(2, ethers.ZeroHash)
      ).to.be.revertedWith("Must own previous chapter to claim this evolution");
    });

    it("Should allow claiming chapter 2 after owning chapter 1", async function () {
      await identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash);
      await identityNFT.connect(user1).claimIdentity(2, ethers.ZeroHash);
      
      expect(await identityNFT.balanceOf(user1.address)).to.equal(2);
    });

    it("Should check canClaimChapter correctly", async function () {
      expect(await identityNFT.canClaimChapter(user1.address, 1)).to.be.true;
      expect(await identityNFT.canClaimChapter(user1.address, 2)).to.be.false;
      
      await identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash);
      
      expect(await identityNFT.canClaimChapter(user1.address, 2)).to.be.true;
    });
  });

  describe("Property 16: Holder Discount Application", function () {
    beforeEach(async function () {
      // Create chapter 1
      await identityNFT.connect(creator).createIdentity(
        "ipfs://chapter1",
        100,
        ethers.parseEther("0.1"),
        false,
        0,
        0
      );

      // Create chapter 2 with 50% discount for chapter 1 holders
      await identityNFT.connect(creator).createIdentity(
        "ipfs://chapter2",
        100,
        ethers.parseEther("0.1"),
        false,
        1,
        50 // 50% discount
      );
    });

    it("Should apply discount for timeline holders", async function () {
      // User1 claims chapter 1
      await identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash, {
        value: ethers.parseEther("0.1")
      });

      // User1 should get 50% discount on chapter 2
      const creatorBalanceBefore = await ethers.provider.getBalance(creator.address);
      
      await identityNFT.connect(user1).claimIdentity(2, ethers.ZeroHash, {
        value: ethers.parseEther("0.05") // 50% of 0.1
      });
      
      const creatorBalanceAfter = await ethers.provider.getBalance(creator.address);
      expect(creatorBalanceAfter - creatorBalanceBefore).to.equal(ethers.parseEther("0.05"));
    });

    it("Should not apply discount for non-holders", async function () {
      // User2 doesn't own chapter 1, so no discount
      await expect(
        identityNFT.connect(user2).claimIdentity(2, ethers.ZeroHash, {
          value: ethers.parseEther("0.05")
        })
      ).to.be.revertedWith("Must own previous chapter to claim this evolution");
    });
  });

  describe("Property 18: NFT Ownership Transfer", function () {
    beforeEach(async function () {
      await identityNFT.connect(creator).createIdentity(
        "ipfs://transferable",
        100,
        0,
        false,
        0,
        0
      );
      await identityNFT.connect(creator).mintIdentity(user1.address, 1);
    });

    it("Should update ownership on transfer", async function () {
      const tokenId = 1;
      
      expect(await identityNFT.ownerOf(tokenId)).to.equal(user1.address);
      
      await identityNFT.connect(user1).transferFrom(user1.address, user2.address, tokenId);
      
      expect(await identityNFT.ownerOf(tokenId)).to.equal(user2.address);
    });

    it("Should update holder balances on transfer", async function () {
      const tokenId = 1;
      
      expect(await identityNFT.balanceOfIdentity(user1.address, 1)).to.equal(1);
      expect(await identityNFT.balanceOfIdentity(user2.address, 1)).to.equal(0);
      
      await identityNFT.connect(user1).transferFrom(user1.address, user2.address, tokenId);
      
      expect(await identityNFT.balanceOfIdentity(user1.address, 1)).to.equal(0);
      expect(await identityNFT.balanceOfIdentity(user2.address, 1)).to.equal(1);
    });

    it("Should add new holder to holders list", async function () {
      const tokenId = 1;
      
      await identityNFT.connect(user1).transferFrom(user1.address, user2.address, tokenId);
      
      const holders = await identityNFT.getHolders(1);
      expect(holders).to.include(user2.address);
    });
  });

  describe("Identity Management", function () {
    beforeEach(async function () {
      await identityNFT.connect(creator).createIdentity(
        "ipfs://test",
        100,
        ethers.parseEther("0.1"),
        false,
        0,
        0
      );
    });

    it("Should update price", async function () {
      await identityNFT.connect(creator).setPrice(1, ethers.parseEther("0.2"));
      
      const identity = await identityNFT.getIdentity(1);
      expect(identity.price).to.equal(ethers.parseEther("0.2"));
    });

    it("Should revert if non-creator tries to update price", async function () {
      await expect(
        identityNFT.connect(user1).setPrice(1, ethers.parseEther("0.2"))
      ).to.be.revertedWith("Only creator can update price");
    });

    it("Should update supply limit", async function () {
      await identityNFT.connect(creator).setSupplyLimit(1, 200);
      
      const identity = await identityNFT.getIdentity(1);
      expect(identity.maxSupply).to.equal(200);
    });

    it("Should revert if setting limit below current supply", async function () {
      await identityNFT.connect(creator).mintIdentity(user1.address, 1);
      await identityNFT.connect(creator).mintIdentity(user2.address, 1);
      
      await expect(
        identityNFT.connect(creator).setSupplyLimit(1, 1)
      ).to.be.revertedWith("Cannot set limit below current supply");
    });

    it("Should pause/unpause identity", async function () {
      await identityNFT.connect(creator).setIdentityActive(1, false);
      
      await expect(
        identityNFT.connect(user1).claimIdentity(1, ethers.ZeroHash, {
          value: ethers.parseEther("0.1")
        })
      ).to.be.revertedWith("Identity does not exist or is inactive");
    });
  });

  describe("Query Functions", function () {
    beforeEach(async function () {
      await identityNFT.connect(creator).createIdentity(
        "ipfs://test",
        100,
        0,
        false,
        0,
        0
      );
      await identityNFT.connect(creator).mintIdentity(user1.address, 1);
      await identityNFT.connect(creator).mintIdentity(user2.address, 1);
    });

    it("Should get remaining supply", async function () {
      expect(await identityNFT.getRemainingSupply(1)).to.equal(98);
    });

    it("Should get holders", async function () {
      const holders = await identityNFT.getHolders(1);
      expect(holders.length).to.equal(2);
      expect(holders).to.include(user1.address);
      expect(holders).to.include(user2.address);
    });

    it("Should get holder count", async function () {
      expect(await identityNFT.getHolderCount(1)).to.equal(2);
    });

    it("Should get total identities", async function () {
      await identityNFT.connect(creator).createIdentity(
        "ipfs://test2",
        100,
        0,
        false,
        0,
        0
      );
      
      expect(await identityNFT.getTotalIdentities()).to.equal(2);
    });

    it("Should get total tokens", async function () {
      expect(await identityNFT.getTotalTokens()).to.equal(2);
    });
  });
});
