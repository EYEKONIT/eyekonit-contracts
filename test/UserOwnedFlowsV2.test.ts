import { expect } from "chai";
import { ethers } from "hardhat";

describe("EYEKON V2 user-owned flows", function () {
  async function deployFixture() {
    const [deployer, owner, admin, member, claimant, outsider, recipient] =
      await ethers.getSigners();

    const access = await (await ethers.getContractFactory("EyekonAccessControl")).deploy();
    const identity = await (await ethers.getContractFactory("IdentityNFTV2")).deploy(
      await access.getAddress(),
    );
    const timeline = await (await ethers.getContractFactory("TimelineV2")).deploy(
      await access.getAddress(),
    );
    const payment = await (await ethers.getContractFactory("PaymentSplitterV2")).deploy(
      await identity.getAddress(),
    );
    const credential = await (
      await ethers.getContractFactory("CredentialRegistryV2")
    ).deploy(await access.getAddress());

    await identity.setTimelineContract(await timeline.getAddress());
    await identity.setPaymentSplitter(await payment.getAddress());
    await timeline.setIdentityContract(await identity.getAddress());

    await access.connect(owner).registerOrganization("Owner Studio");
    const ownerRole = await access.ORG_OWNER_ROLE();
    const adminRole = await access.ORG_ADMIN_ROLE();
    expect(await access.getMemberRole(1, owner.address)).to.equal(ownerRole);
    await access.connect(owner).addOrganizationMember(1, admin.address, adminRole);
    await access.connect(owner).addOrganizationMember(1, member.address, await access.ORG_MEMBER_ROLE());

    return {
      deployer,
      owner,
      admin,
      member,
      claimant,
      outsider,
      recipient,
      access,
      identity,
      timeline,
      payment,
      credential,
    };
  }

  async function createIdentity(
    identity: any,
    signer: any,
    name: string,
    organizationId = 0,
    options: {
      price?: bigint;
      previous?: bigint;
      policy?: number;
    } = {},
  ) {
    const id = (await identity.getTotalIdentities()) + 1n;
    await identity
      .connect(signer)
      .createIdentity(
        name,
        organizationId,
        `ipfs://${name}`,
        100,
        options.price ?? 0,
        true,
        options.previous ?? 0,
        0,
        options.policy ?? 0,
      );
    return id;
  }

  it("makes the connected user the creator of personal identities", async function () {
    const { outsider, identity } = await deployFixture();
    const id = await createIdentity(identity, outsider, "Personal Identity");
    expect((await identity.getIdentity(id)).creator).to.equal(outsider.address);
  });

  it("requires organization authority for organization identities", async function () {
    const { owner, admin, member, identity } = await deployFixture();
    await expect(
      createIdentity(identity, member, "Member Cannot Create", 1),
    ).to.be.revertedWith("Not an organization owner or admin");
    const ownerId = await createIdentity(identity, owner, "Owner Identity", 1);
    const adminId = await createIdentity(identity, admin, "Admin Identity", 1);
    expect((await identity.getIdentity(ownerId)).creator).to.equal(owner.address);
    expect((await identity.getIdentity(adminId)).creator).to.equal(admin.address);
  });

  it("rejects equivalent identity names globally", async function () {
    const { owner, outsider, identity } = await deployFixture();
    await createIdentity(identity, owner, "Premium   Founder");
    await expect(
      createIdentity(identity, outsider, "  PREMIUM founder  "),
    ).to.be.revertedWith("Identity name already exists");
  });

  it("enforces creator-signed invite vouchers bound to claimant and expiry", async function () {
    const { owner, claimant, outsider, identity } = await deployFixture();
    const id = await createIdentity(identity, owner, "Invite Identity", 0, {
      policy: 1,
    });
    const network = await ethers.provider.getNetwork();
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nonce = ethers.id("one-use-invitation");
    const signature = await owner.signTypedData(
      {
        name: "EYEKON Identity",
        version: "2",
        chainId: network.chainId,
        verifyingContract: await identity.getAddress(),
      },
      {
        ClaimVoucher: [
          { name: "identityId", type: "uint256" },
          { name: "claimant", type: "address" },
          { name: "nonce", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { identityId: id, claimant: claimant.address, nonce, deadline },
    );

    await expect(
      identity.connect(outsider).claimIdentity(id, nonce, deadline, signature),
    ).to.be.revertedWith("Invalid invitation signature");
    await expect(identity.connect(claimant).claimIdentity(id, nonce, deadline, signature))
      .to.emit(identity, "IdentityClaimed")
      .withArgs(id, claimant.address, 1, 0);
    await expect(
      identity.connect(claimant).claimIdentity(id, nonce, deadline, signature),
    ).to.be.revertedWith("Invitation already used");
  });

  it("prevents public and private claim-policy bypasses", async function () {
    const { owner, claimant, identity } = await deployFixture();
    const publicId = await createIdentity(identity, owner, "Public Identity");
    const privateId = await createIdentity(identity, owner, "Private Identity", 0, {
      policy: 2,
    });
    await identity.connect(claimant).claimIdentity(publicId, ethers.ZeroHash, 0, "0x");
    await expect(
      identity.connect(claimant).claimIdentity(privateId, ethers.ZeroHash, 0, "0x"),
    ).to.be.revertedWith("Identity is private");
  });

  it("keeps evolution progress user-signed and ordered", async function () {
    const { owner, claimant, outsider, identity, timeline } = await deployFixture();
    await timeline.connect(owner).createTimeline(1, "Founder Journey", "Evolution", 2, 0);
    const first = await createIdentity(identity, owner, "Founder Chapter One", 1);
    const second = await createIdentity(identity, owner, "Founder Chapter Two", 1, {
      previous: first,
    });
    await timeline.connect(owner).addChapter(1, 1, first, false);
    await timeline.connect(owner).addChapter(1, 2, second, true);
    await identity.connect(owner).linkIdentityToTimeline(first, 1);
    await identity.connect(owner).linkIdentityToTimeline(second, 1);

    await expect(
      timeline.connect(outsider).completeChapterByIdentity(1, first, claimant.address),
    ).to.be.revertedWith("Only identity contract");
    await expect(
      identity.connect(claimant).claimIdentity(second, ethers.ZeroHash, 0, "0x"),
    ).to.be.revertedWith("Previous identity required");
    await identity.connect(claimant).claimIdentity(first, ethers.ZeroHash, 0, "0x");
    await identity.connect(claimant).claimIdentity(second, ethers.ZeroHash, 0, "0x");
    const progress = await timeline.getUserProgress(1, claimant.address);
    expect(progress[1]).to.equal(2);
    expect(progress[2]).to.equal(true);
  });

  it("allows only organization owners and admins to create timelines", async function () {
    const { owner, admin, member, timeline } = await deployFixture();
    await expect(
      timeline.connect(member).createTimeline(1, "Denied Timeline", "No", 1, 0),
    ).to.be.revertedWith("Not an organization owner or admin");
    await timeline.connect(admin).createTimeline(1, "Admin Timeline", "Yes", 1, 0);
    expect((await timeline.getTimeline(1)).creator).to.equal(admin.address);
    await expect(
      timeline.connect(owner).createTimeline(1, " admin   TIMELINE ", "Duplicate", 1, 0),
    ).to.be.revertedWith("Timeline name already exists");
  });

  it("records the actual organization wallet as credential issuer", async function () {
    const { owner, admin, member, recipient, credential } = await deployFixture();
    const hash = ethers.id("credential-data");
    await expect(
      credential.connect(member).issueCredential(1, recipient.address, hash, 1, 0, false),
    ).to.be.revertedWith("Not an organization owner or admin");
    const tx = await credential
      .connect(admin)
      .issueCredential(1, recipient.address, hash, 1, 0, false);
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((log: any) => {
        try { return credential.interface.parseLog(log); } catch { return null; }
      })
      .find((item: any) => item?.name === "CredentialIssued");
    const id = event!.args.attestationId;
    expect((await credential.getAttestation(id)).issuer).to.equal(admin.address);
    await credential.connect(owner).revokeCredential(id, "Organization revoked");
    expect((await credential.getAttestation(id)).isRevoked).to.equal(true);
  });

  it("lets only the identity creator configure royalties and preserves every wei", async function () {
    const { owner, claimant, outsider, recipient, identity, payment } = await deployFixture();
    const price = 101n;
    const id = await createIdentity(identity, owner, "Paid Identity", 0, { price });
    await expect(
      payment.connect(outsider).configureRoyalty(id, 500, [owner.address], [10000]),
    ).to.be.revertedWith("Only identity creator");
    await payment
      .connect(owner)
      .configureRoyalty(id, 500, [owner.address, recipient.address], [5000, 5000]);
    await identity.connect(claimant).claimIdentity(id, ethers.ZeroHash, 0, "0x", { value: price });
    const first = await payment.getPendingWithdrawal(id, owner.address);
    const second = await payment.getPendingWithdrawal(id, recipient.address);
    expect(first + second).to.equal(price);
  });
});
