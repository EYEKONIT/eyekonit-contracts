import { expect } from "chai";
import { ethers } from "hardhat";
import { EyekonAccessControl, CredentialRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CredentialRegistry", function () {
  let accessControl: EyekonAccessControl;
  let credentialRegistry: CredentialRegistry;
  let owner: SignerWithAddress;
  let issuer: SignerWithAddress;
  let recipient: SignerWithAddress;
  let user1: SignerWithAddress;

  beforeEach(async function () {
    [owner, issuer, recipient, user1] = await ethers.getSigners();
    
    // Deploy AccessControl
    const AccessControl = await ethers.getContractFactory("EyekonAccessControl");
    accessControl = await AccessControl.deploy();
    await accessControl.waitForDeployment();
    
    // Deploy CredentialRegistry
    const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");
    credentialRegistry = await CredentialRegistry.deploy(await accessControl.getAddress());
    await credentialRegistry.waitForDeployment();
    
    // Register organization for issuer
    await accessControl.connect(issuer).registerOrganization("Test Org");
  });

  describe("Deployment", function () {
    it("Should link to AccessControl contract", async function () {
      expect(await credentialRegistry.accessControl()).to.equal(await accessControl.getAddress());
    });
  });

  describe("Property 37: Credential Attestation Creation", function () {
    it("Should create attestation on issuance", async function () {
      const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("credential-data"));
      const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
      
      const tx = await credentialRegistry.connect(issuer).issueCredential(
        recipient.address,
        credentialHash,
        1,
        expiresAt,
        false
      );
      const receipt = await tx.wait();
      
      // Get attestation ID from event
      const event = receipt!.logs.find((log: any) => {
        try {
          return credentialRegistry.interface.parseLog(log)?.name === "CredentialIssued";
        } catch {
          return false;
        }
      });
      
      expect(event).to.not.be.undefined;
    });

    it("Should store attestation with correct data", async function () {
      const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("credential-data"));
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      
      const tx = await credentialRegistry.connect(issuer).issueCredential(
        recipient.address,
        credentialHash,
        1,
        expiresAt,
        true
      );
      const receipt = await tx.wait();
      
      // Get attestation ID from event
      const event = receipt!.logs.find((log: any) => {
        try {
          const parsed = credentialRegistry.interface.parseLog(log);
          return parsed?.name === "CredentialIssued";
        } catch {
          return false;
        }
      });
      
      const attestationId = credentialRegistry.interface.parseLog(event!)?.args[0];
      
      const attestation = await credentialRegistry.getAttestation(attestationId);
      expect(attestation.issuer).to.equal(issuer.address);
      expect(attestation.recipient).to.equal(recipient.address);
      expect(attestation.credentialHash).to.equal(credentialHash);
      expect(attestation.transferable).to.be.true;
      expect(attestation.isRevoked).to.be.false;
    });

    it("Should emit CredentialIssued event", async function () {
      const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("credential-data"));
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      
      await expect(
        credentialRegistry.connect(issuer).issueCredential(
          recipient.address,
          credentialHash,
          1,
          expiresAt,
          false
        )
      ).to.emit(credentialRegistry, "CredentialIssued");
    });

    it("Should revert if non-authorized tries to issue", async function () {
      const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("credential-data"));
      
      await expect(
        credentialRegistry.connect(user1).issueCredential(
          recipient.address,
          credentialHash,
          1,
          0,
          false
        )
      ).to.be.revertedWith("Not authorized to issue credentials");
    });

    it("Should revert with invalid recipient", async function () {
      const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("credential-data"));
      
      await expect(
        credentialRegistry.connect(issuer).issueCredential(
          ethers.ZeroAddress,
          credentialHash,
          1,
          0,
          false
        )
      ).to.be.revertedWith("Invalid recipient address");
    });

    it("Should revert with invalid credential hash", async function () {
      await expect(
        credentialRegistry.connect(issuer).issueCredential(
          recipient.address,
          ethers.ZeroHash,
          1,
          0,
          false
        )
      ).to.be.revertedWith("Invalid credential hash");
    });
  });

  describe("Property 38: Credential Revocation Status Update", function () {
    let attestationId: string;

    beforeEach(async function () {
      const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("credential-data"));
      const tx = await credentialRegistry.connect(issuer).issueCredential(
        recipient.address,
        credentialHash,
        1,
        0,
        false
      );
      const receipt = await tx.wait();
      
      const event = receipt!.logs.find((log: any) => {
        try {
          const parsed = credentialRegistry.interface.parseLog(log);
          return parsed?.name === "CredentialIssued";
        } catch {
          return false;
        }
      });
      
      attestationId = credentialRegistry.interface.parseLog(event!)?.args[0];
    });

    it("Should update revocation status", async function () {
      await credentialRegistry.connect(issuer).revokeCredential(attestationId, "Test reason");
      
      const attestation = await credentialRegistry.getAttestation(attestationId);
      expect(attestation.isRevoked).to.be.true;
      expect(attestation.revocationReason).to.equal("Test reason");
      expect(attestation.revokedAt).to.be.greaterThan(0);
    });

    it("Should emit CredentialRevoked event", async function () {
      await expect(
        credentialRegistry.connect(issuer).revokeCredential(attestationId, "Test reason")
      ).to.emit(credentialRegistry, "CredentialRevoked");
    });

    it("Should revert if non-issuer tries to revoke", async function () {
      await expect(
        credentialRegistry.connect(user1).revokeCredential(attestationId, "Test reason")
      ).to.be.revertedWith("Only issuer can revoke");
    });

    it("Should revert if already revoked", async function () {
      await credentialRegistry.connect(issuer).revokeCredential(attestationId, "First revocation");
      
      await expect(
        credentialRegistry.connect(issuer).revokeCredential(attestationId, "Second revocation")
      ).to.be.revertedWith("Already revoked");
    });

    it("Should mark credential as invalid after revocation", async function () {
      expect(await credentialRegistry.isCredentialValid(attestationId)).to.be.true;
      
      await credentialRegistry.connect(issuer).revokeCredential(attestationId, "Test reason");
      
      expect(await credentialRegistry.isCredentialValid(attestationId)).to.be.false;
    });
  });

  describe("Credential Verification", function () {
    let attestationId: string;

    beforeEach(async function () {
      const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("credential-data"));
      const tx = await credentialRegistry.connect(issuer).issueCredential(
        recipient.address,
        credentialHash,
        1,
        0,
        false
      );
      const receipt = await tx.wait();
      
      const event = receipt!.logs.find((log: any) => {
        try {
          const parsed = credentialRegistry.interface.parseLog(log);
          return parsed?.name === "CredentialIssued";
        } catch {
          return false;
        }
      });
      
      attestationId = credentialRegistry.interface.parseLog(event!)?.args[0];
    });

    it("Should verify valid credential", async function () {
      const [isValid, issuerAddr, recipientAddr, issuedAt, expiresAt, isRevoked] = 
        await credentialRegistry.verifyCredential(attestationId);
      
      expect(isValid).to.be.true;
      expect(issuerAddr).to.equal(issuer.address);
      expect(recipientAddr).to.equal(recipient.address);
      expect(isRevoked).to.be.false;
    });

    it("Should return false for non-existent credential", async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      const [isValid] = await credentialRegistry.verifyCredential(fakeId);
      
      expect(isValid).to.be.false;
    });

    it("Should return false for revoked credential", async function () {
      await credentialRegistry.connect(issuer).revokeCredential(attestationId, "Test");
      
      const [isValid, , , , , isRevoked] = await credentialRegistry.verifyCredential(attestationId);
      
      expect(isValid).to.be.false;
      expect(isRevoked).to.be.true;
    });

    it("Should return false for expired credential", async function () {
      // Get current block timestamp
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentTime = latestBlock!.timestamp;
      const expiresAt = currentTime + 100;
      
      // Issue credential that expires in 100 seconds
      const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("expiring-credential"));
      
      const tx = await credentialRegistry.connect(issuer).issueCredential(
        recipient.address,
        credentialHash,
        1,
        expiresAt,
        false
      );
      const receipt = await tx.wait();
      
      const event = receipt!.logs.find((log: any) => {
        try {
          const parsed = credentialRegistry.interface.parseLog(log);
          return parsed?.name === "CredentialIssued";
        } catch {
          return false;
        }
      });
      
      const expiringAttestationId = credentialRegistry.interface.parseLog(event!)?.args[0];
      
      // Fast forward time past expiry using Hardhat's time manipulation
      await ethers.provider.send("evm_increaseTime", [101]);
      await ethers.provider.send("evm_mine", []);
      
      const [isValid] = await credentialRegistry.verifyCredential(expiringAttestationId);
      expect(isValid).to.be.false;
    });
  });

  describe("Property 17: Non-transferable Credential Enforcement", function () {
    let attestationId: string;

    beforeEach(async function () {
      const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("non-transferable"));
      const tx = await credentialRegistry.connect(issuer).issueCredential(
        recipient.address,
        credentialHash,
        1,
        0,
        false // Non-transferable
      );
      const receipt = await tx.wait();
      
      const event = receipt!.logs.find((log: any) => {
        try {
          const parsed = credentialRegistry.interface.parseLog(log);
          return parsed?.name === "CredentialIssued";
        } catch {
          return false;
        }
      });
      
      attestationId = credentialRegistry.interface.parseLog(event!)?.args[0];
    });

    it("Should revert transfer of non-transferable credential", async function () {
      await expect(
        credentialRegistry.connect(recipient).transferCredential(attestationId, user1.address)
      ).to.be.revertedWith("Credential is not transferable");
    });
  });

  describe("Credential Transfer", function () {
    let attestationId: string;

    beforeEach(async function () {
      const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("transferable"));
      const tx = await credentialRegistry.connect(issuer).issueCredential(
        recipient.address,
        credentialHash,
        1,
        0,
        true // Transferable
      );
      const receipt = await tx.wait();
      
      const event = receipt!.logs.find((log: any) => {
        try {
          const parsed = credentialRegistry.interface.parseLog(log);
          return parsed?.name === "CredentialIssued";
        } catch {
          return false;
        }
      });
      
      attestationId = credentialRegistry.interface.parseLog(event!)?.args[0];
    });

    it("Should transfer credential to new recipient", async function () {
      await credentialRegistry.connect(recipient).transferCredential(attestationId, user1.address);
      
      const attestation = await credentialRegistry.getAttestation(attestationId);
      expect(attestation.recipient).to.equal(user1.address);
    });

    it("Should emit CredentialTransferred event", async function () {
      await expect(
        credentialRegistry.connect(recipient).transferCredential(attestationId, user1.address)
      ).to.emit(credentialRegistry, "CredentialTransferred")
        .withArgs(attestationId, recipient.address, user1.address);
    });

    it("Should revert if non-recipient tries to transfer", async function () {
      await expect(
        credentialRegistry.connect(user1).transferCredential(attestationId, user1.address)
      ).to.be.revertedWith("Only current recipient can transfer");
    });

    it("Should revert transfer of revoked credential", async function () {
      await credentialRegistry.connect(issuer).revokeCredential(attestationId, "Test");
      
      await expect(
        credentialRegistry.connect(recipient).transferCredential(attestationId, user1.address)
      ).to.be.revertedWith("Cannot transfer revoked credential");
    });
  });

  describe("Batch Issuance", function () {
    it("Should issue multiple credentials at once", async function () {
      const recipients = [recipient.address, user1.address];
      const hashes = [
        ethers.keccak256(ethers.toUtf8Bytes("cred1")),
        ethers.keccak256(ethers.toUtf8Bytes("cred2"))
      ];
      
      const tx = await credentialRegistry.connect(issuer).batchIssueCredentials(
        recipients,
        hashes,
        1,
        0,
        false
      );
      const receipt = await tx.wait();
      
      // Count CredentialIssued events
      const events = receipt!.logs.filter((log: any) => {
        try {
          const parsed = credentialRegistry.interface.parseLog(log);
          return parsed?.name === "CredentialIssued";
        } catch {
          return false;
        }
      });
      
      expect(events.length).to.equal(2);
    });

    it("Should revert if array lengths mismatch", async function () {
      const recipients = [recipient.address];
      const hashes = [
        ethers.keccak256(ethers.toUtf8Bytes("cred1")),
        ethers.keccak256(ethers.toUtf8Bytes("cred2"))
      ];
      
      await expect(
        credentialRegistry.connect(issuer).batchIssueCredentials(
          recipients,
          hashes,
          1,
          0,
          false
        )
      ).to.be.revertedWith("Array length mismatch");
    });

    it("Should revert with empty arrays", async function () {
      await expect(
        credentialRegistry.connect(issuer).batchIssueCredentials(
          [],
          [],
          1,
          0,
          false
        )
      ).to.be.revertedWith("Empty arrays");
    });
  });

  describe("Query Functions", function () {
    let attestationId1: string;
    let attestationId2: string;

    beforeEach(async function () {
      const hash1 = ethers.keccak256(ethers.toUtf8Bytes("cred1"));
      const hash2 = ethers.keccak256(ethers.toUtf8Bytes("cred2"));
      
      const tx1 = await credentialRegistry.connect(issuer).issueCredential(
        recipient.address,
        hash1,
        1,
        0,
        false
      );
      const receipt1 = await tx1.wait();
      
      const event1 = receipt1!.logs.find((log: any) => {
        try {
          const parsed = credentialRegistry.interface.parseLog(log);
          return parsed?.name === "CredentialIssued";
        } catch {
          return false;
        }
      });
      
      attestationId1 = credentialRegistry.interface.parseLog(event1!)?.args[0];
      
      const tx2 = await credentialRegistry.connect(issuer).issueCredential(
        recipient.address,
        hash2,
        1,
        0,
        false
      );
      const receipt2 = await tx2.wait();
      
      const event2 = receipt2!.logs.find((log: any) => {
        try {
          const parsed = credentialRegistry.interface.parseLog(log);
          return parsed?.name === "CredentialIssued";
        } catch {
          return false;
        }
      });
      
      attestationId2 = credentialRegistry.interface.parseLog(event2!)?.args[0];
    });

    it("Should get credentials by recipient", async function () {
      const credentials = await credentialRegistry.getCredentialsByRecipient(recipient.address);
      expect(credentials.length).to.equal(2);
    });

    it("Should get credentials by issuer", async function () {
      const credentials = await credentialRegistry.getCredentialsByIssuer(issuer.address);
      expect(credentials.length).to.equal(2);
    });

    it("Should get recipient credential count", async function () {
      const count = await credentialRegistry.getRecipientCredentialCount(recipient.address);
      expect(count).to.equal(2);
    });

    it("Should get issuer credential count", async function () {
      const count = await credentialRegistry.getIssuerCredentialCount(issuer.address);
      expect(count).to.equal(2);
    });
  });
});
