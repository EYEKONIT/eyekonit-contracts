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
    await identity.connect(owner).setPrice(adminId, 25);
    expect((await identity.getIdentity(adminId)).price).to.equal(25);
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
          { name: "authorizedClaimant", type: "address" },
          { name: "nonce", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { identityId: id, authorizedClaimant: claimant.address, nonce, deadline },
    );

    await expect(
      identity.connect(outsider).claimIdentity(id, claimant.address, nonce, deadline, signature),
    ).to.be.revertedWith("Invitation is for another wallet");
    await expect(identity.connect(claimant).claimIdentity(id, claimant.address, nonce, deadline, signature))
      .to.emit(identity, "IdentityClaimed")
      .withArgs(id, claimant.address, 1, 0);
    await expect(
      identity.connect(claimant).claimIdentity(id, claimant.address, nonce, deadline, signature),
    ).to.be.revertedWith("Invitation already used");
  });

  it("supports one-time creator-signed bearer invitations for email recipients", async function () {
    const { owner, claimant, outsider, identity } = await deployFixture();
    const id = await createIdentity(identity, owner, "Email Invite Identity", 0, {
      policy: 1,
    });
    const network = await ethers.provider.getNetwork();
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nonce = ethers.id("email-invitation-token");
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
          { name: "authorizedClaimant", type: "address" },
          { name: "nonce", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        identityId: id,
        authorizedClaimant: ethers.ZeroAddress,
        nonce,
        deadline,
      },
    );
    await identity
      .connect(claimant)
      .claimIdentity(id, ethers.ZeroAddress, nonce, deadline, signature);
    await expect(
      identity
        .connect(outsider)
        .claimIdentity(id, ethers.ZeroAddress, nonce, deadline, signature),
    ).to.be.revertedWith("Invitation already used");
  });

  it("prevents public and private claim-policy bypasses", async function () {
    const { owner, claimant, identity } = await deployFixture();
    const publicId = await createIdentity(identity, owner, "Public Identity");
    const privateId = await createIdentity(identity, owner, "Private Identity", 0, {
      policy: 2,
    });
    await identity.connect(claimant).claimIdentity(publicId, ethers.ZeroAddress, ethers.ZeroHash, 0, "0x");
    await expect(
      identity.connect(claimant).claimIdentity(privateId, ethers.ZeroAddress, ethers.ZeroHash, 0, "0x"),
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
      identity.connect(claimant).claimIdentity(second, ethers.ZeroAddress, ethers.ZeroHash, 0, "0x"),
    ).to.be.revertedWith("Previous identity required");
    await identity.connect(claimant).claimIdentity(first, ethers.ZeroAddress, ethers.ZeroHash, 0, "0x");
    await identity.connect(claimant).claimIdentity(second, ethers.ZeroAddress, ethers.ZeroHash, 0, "0x");
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

  it("supports issuer-signed credential invitation vouchers", async function () {
    const { admin, claimant, outsider, credential } = await deployFixture();
    const network = await ethers.provider.getNetwork();
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nonce = ethers.id("credential-invitation");
    const credentialHash = ethers.id("invited-credential");
    const domain = {
      name: "EYEKON Credential",
      version: "2",
      chainId: network.chainId,
      verifyingContract: await credential.getAddress(),
    };
    const types = {
      IssuanceVoucher: [
        { name: "organizationId", type: "uint256" },
        { name: "issuer", type: "address" },
        { name: "authorizedRecipient", type: "address" },
        { name: "credentialHash", type: "bytes32" },
        { name: "credentialTypeId", type: "uint256" },
        { name: "expiresAt", type: "uint256" },
        { name: "transferable", type: "bool" },
        { name: "nonce", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const value = {
      organizationId: 1,
      issuer: admin.address,
      authorizedRecipient: claimant.address,
      credentialHash,
      credentialTypeId: 7,
      expiresAt: 0,
      transferable: false,
      nonce,
      deadline,
    };
    const signature = await admin.signTypedData(domain, types, value);
    await expect(
      credential
        .connect(outsider)
        .claimCredentialWithVoucher(
          1,
          admin.address,
          claimant.address,
          credentialHash,
          7,
          0,
          false,
          nonce,
          deadline,
          signature,
        ),
    ).to.be.revertedWith("Invitation is for another wallet");
    await credential
      .connect(claimant)
      .claimCredentialWithVoucher(
        1,
        admin.address,
        claimant.address,
        credentialHash,
        7,
        0,
        false,
        nonce,
        deadline,
        signature,
      );
    expect(await credential.getRecipientCredentialCount(claimant.address)).to.equal(1);
  });

  it("keeps secondary royalty recipients from redirecting primary sale revenue", async function () {
    const { owner, claimant, outsider, recipient, identity, payment } = await deployFixture();
    const price = 101n;
    const id = await createIdentity(identity, owner, "Paid Identity", 0, { price });
    await expect(
      payment.connect(outsider).configureRoyalty(id, 500, [owner.address], [10000]),
    ).to.be.revertedWith("Not authorized for identity");
    await payment
      .connect(owner)
      .configureRoyalty(id, 500, [owner.address, recipient.address], [5000, 5000]);
    const platform = await payment.PLATFORM_WALLET();
    await expect(identity.connect(claimant).claimIdentity(id, ethers.ZeroAddress, ethers.ZeroHash, 0, "0x", { value: price }))
      .to.changeEtherBalances([owner, platform], [81n, 20n]);
    expect(await payment.getPendingWithdrawal(id, recipient.address)).to.equal(0);
    expect(await payment.getPendingWithdrawal(id, owner.address)).to.equal(0);
    // Secondary royalty withdrawals retain the existing exact-wei behavior.
    await payment.connect(claimant).processSecondarySale(id, 2020n, { value: 101n });
    const first = await payment.getPendingWithdrawal(id, owner.address);
    const second = await payment.getPendingWithdrawal(id, recipient.address);
    expect(first + second).to.equal(101n);
  });

  it("automatically pays 80/20 without any royalty configuration", async function () {
    const { owner, claimant, identity, payment } = await deployFixture();
    const price = ethers.parseEther('1');
    const id = await createIdentity(identity, owner, 'Automatic Purchase', 0, { price });
    expect(await payment.isRoyaltyConfigured(id)).to.equal(true);
    expect(await payment.isSecondaryRoyaltyConfigured(id)).to.equal(false);
    const platform = await payment.PLATFORM_WALLET();
    const tx = identity.connect(claimant).claimIdentity(id, ethers.ZeroAddress, ethers.ZeroHash, 0, '0x', { value: price });
    await expect(tx).to.changeEtherBalances([owner, platform], [price * 8n / 10n, price / 5n]);
    await expect(tx).to.emit(payment, 'PrimarySaleSettled').withArgs(id, owner.address, platform, price, price * 8n / 10n, price / 5n);
    expect(await identity.balanceOfIdentity(claimant.address, id)).to.equal(1);
    expect(await payment.totalEarnings(owner.address)).to.equal(price * 8n / 10n);
    expect(await ethers.provider.getBalance(await payment.getAddress())).to.equal(0);
  });

  it("uses the organization identity creator as the payout owner", async function () {
    const { admin, claimant, identity, payment } = await deployFixture();
    const id = await createIdentity(identity, admin, 'Organization Purchase', 1, { price: 1000n });
    await expect(identity.connect(claimant).claimIdentity(id, ethers.ZeroAddress, ethers.ZeroHash, 0, '0x', { value: 1000n }))
      .to.changeEtherBalances([admin, await payment.PLATFORM_WALLET()], [800n, 200n]);
  });

  it("splits the discounted evolution chapter price and refunds overpayment", async function () {
    const { owner, claimant, identity, payment, timeline } = await deployFixture();
    const previous = await createIdentity(identity, owner, 'First Chapter');
    await timeline.connect(owner).createTimeline(1, 'Paid Evolution', 'Two chapters', 2, 25);
    await timeline.connect(owner).addChapter(1, 1, previous, false);
    await identity.connect(owner).linkIdentityToTimeline(previous, 1);
    await identity.connect(claimant).claimIdentity(previous, ethers.ZeroAddress, ethers.ZeroHash, 0, '0x');
    await identity.connect(owner).createIdentity('Discount Chapter', 0, 'ipfs://chapter', 100, 1000n, true, previous, 25, 0);
    const id = await identity.getTotalIdentities();
    await timeline.connect(owner).addChapter(1, 2, id, true);
    await identity.connect(owner).linkIdentityToTimeline(id, 1);
    const platform = await payment.PLATFORM_WALLET();
    await expect(identity.connect(claimant).claimIdentity(id, ethers.ZeroAddress, ethers.ZeroHash, 0, '0x', { value: 1200n }))
      .to.changeEtherBalances([owner, platform, claimant], [600n, 150n, -750n]);
  });

  it("never charges commission on a free claim and refunds accidental value", async function () {
    const { owner, claimant, identity, payment } = await deployFixture();
    const id = await createIdentity(identity, owner, 'Free Claim');
    await expect(identity.connect(claimant).claimIdentity(id, ethers.ZeroAddress, ethers.ZeroHash, 0, '0x', { value: 100n }))
      .to.changeEtherBalances([owner, await payment.PLATFORM_WALLET(), claimant], [0n, 0n, 0n]);
  });

  it("rejects underpayment and direct splitter calls without minting", async function () {
    const { owner, claimant, identity, payment } = await deployFixture();
    const id = await createIdentity(identity, owner, 'Underpayment', 0, { price: 100n });
    await expect(identity.connect(claimant).claimIdentity(id, ethers.ZeroAddress, ethers.ZeroHash, 0, '0x', { value: 99n })).to.be.revertedWith('Insufficient payment');
    await expect(payment.connect(claimant).processPrimarySale(id, { value: 100n })).to.be.revertedWith('Only identity contract');
    expect(await identity.balanceOfIdentity(claimant.address, id)).to.equal(0);
  });

  it("applies commission to a paid creator-signed invitation", async function () {
    const { owner, claimant, identity, payment } = await deployFixture();
    const id = await createIdentity(identity, owner, 'Paid Invite', 0, { price: 100n, policy: 1 });
    const nonce = ethers.id('paid-invite');
    const deadline = (await ethers.provider.getBlock('latest'))!.timestamp + 3600;
    const signature = await owner.signTypedData({ name: 'EYEKON Identity', version: '2', chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await identity.getAddress() }, {
      ClaimVoucher: [{ name: 'identityId', type: 'uint256' }, { name: 'authorizedClaimant', type: 'address' }, { name: 'nonce', type: 'bytes32' }, { name: 'deadline', type: 'uint256' }],
    }, { identityId: id, authorizedClaimant: claimant.address, nonce, deadline });
    await expect(identity.connect(claimant).claimIdentity(id, claimant.address, nonce, deadline, signature, { value: 100n }))
      .to.changeEtherBalances([owner, await payment.PLATFORM_WALLET()], [80n, 20n]);
  });

  it("preserves every wei even for a one-wei price", async function () {
    const { owner, claimant, identity, payment } = await deployFixture();
    const id = await createIdentity(identity, owner, 'One Wei', 0, { price: 1n });
    await expect(identity.connect(claimant).claimIdentity(id, ethers.ZeroAddress, ethers.ZeroHash, 0, '0x', { value: 1n }))
      .to.changeEtherBalances([owner, await payment.PLATFORM_WALLET()], [1n, 0n]);
  });

  it("preserves existing secondary royalty settings when replacing the splitter", async function () {
    const { owner, claimant, recipient, identity, payment } = await deployFixture();
    const id = await createIdentity(identity, owner, 'Preserved Royalty', 0, { price: 100n });
    await payment.connect(owner).configureRoyalty(id, 500, [owner.address, recipient.address], [5000, 5000]);
    const replacement = await (await ethers.getContractFactory('PaymentSplitterV2')).deploy(await identity.getAddress());
    expect(await replacement.legacySplitter()).to.equal(await payment.getAddress());
    await identity.setPaymentSplitter(await replacement.getAddress());
    expect(await replacement.isSecondaryRoyaltyConfigured(id)).to.equal(true);
    expect(await replacement.getRoyaltyPercentage(id)).to.equal(500);
    const [recipients, amounts] = await replacement.getRoyaltyInfo(id, 2020n);
    expect(recipients).to.deep.equal([owner.address, recipient.address]);
    expect(amounts).to.deep.equal([50n, 51n]);
    await replacement.connect(claimant).processSecondarySale(id, 2020n, { value: 101n });
    expect(await replacement.getTotalPendingWithdrawals(owner.address, [id])).to.equal(50n);
    expect(await replacement.getPendingWithdrawal(id, recipient.address)).to.equal(51n);
    await expect(identity.connect(claimant).claimIdentity(id, ethers.ZeroAddress, ethers.ZeroHash, 0, '0x', { value: 100n }))
      .to.changeEtherBalances([owner, await replacement.PLATFORM_WALLET()], [80n, 20n]);
  });

  for (const target of ['owner', 'platform'] as const) {
    it(`reverts the whole claim if the ${target} rejects payment`, async function () {
      const { owner, claimant, identity, payment } = await deployFixture();
      const id = await createIdentity(identity, owner, `Reject ${target}`, 0, { price: 100n });
      const address = target === 'owner' ? owner.address : await payment.PLATFORM_WALLET();
      await ethers.provider.send('hardhat_setCode', [address, '0x60006000fd']);
      try {
        await expect(identity.connect(claimant).claimIdentity(id, ethers.ZeroAddress, ethers.ZeroHash, 0, '0x', { value: 100n }))
          .to.be.revertedWith(target === 'owner' ? 'Owner payment failed' : 'Platform payment failed');
        expect(await identity.balanceOfIdentity(claimant.address, id)).to.equal(0);
        expect((await identity.getIdentity(id)).supply).to.equal(0);
        expect(await payment.totalEarnings(owner.address)).to.equal(0);
      } finally { await ethers.provider.send('hardhat_setCode', [address, '0x']); }
    });
  }
});
