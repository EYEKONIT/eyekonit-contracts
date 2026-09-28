import { ethers } from "hardhat";
import deployment from "../deployments/amoy-v2.2.json";

async function main() {
  const [owner] = await ethers.getSigners();
  const claimant = ethers.Wallet.createRandom().connect(ethers.provider);
  await (
    await owner.sendTransaction({
      to: claimant.address,
      value: ethers.parseEther("1"),
    })
  ).wait();

  const access = await ethers.getContractAt(
    "EyekonAccessControl",
    deployment.contracts.AccessControl,
  );
  const identity = await ethers.getContractAt(
    "IdentityNFTV2",
    deployment.contracts.IdentityNFT,
  );
  const timeline = await ethers.getContractAt(
    "TimelineV2",
    deployment.contracts.Timeline,
  );
  const credential = await ethers.getContractAt(
    "CredentialRegistryV2",
    deployment.contracts.CredentialRegistry,
  );
  const payment = await ethers.getContractAt(
    "PaymentSplitterV2",
    deployment.contracts.PaymentSplitter,
  );

  const suffix = Date.now().toString();
  const orgReceipt = await (
    await access.registerOrganization(`Smoke Organization ${suffix}`)
  ).wait();
  const orgEvent = orgReceipt!.logs
    .map((log) => {
      try { return access.interface.parseLog(log); } catch { return null; }
    })
    .find((item) => item?.name === "OrganizationRegistered");
  const organizationId = orgEvent!.args.orgId;

  await (
    await timeline.createTimeline(
      organizationId,
      `Smoke Timeline ${suffix}`,
      "Live Amoy V2.2 smoke test",
      1,
      0,
    )
  ).wait();

  const identityReceipt = await (
    await identity.createIdentity(
      `Smoke Identity ${suffix}`,
      organizationId,
      `ipfs://smoke-${suffix}`,
      10,
      0,
      true,
      0,
      0,
      0,
    )
  ).wait();
  const identityEvent = identityReceipt!.logs
    .map((log) => {
      try { return identity.interface.parseLog(log); } catch { return null; }
    })
    .find((item) => item?.name === "IdentityCreated");
  const identityId = identityEvent!.args.identityId;
  await (
    await identity
      .connect(claimant)
      .claimIdentity(identityId, ethers.ZeroAddress, ethers.ZeroHash, 0, "0x")
  ).wait();

  const inviteReceipt = await (
    await identity.createIdentity(
      `Smoke Invite ${suffix}`,
      organizationId,
      `ipfs://smoke-invite-${suffix}`,
      1,
      0,
      false,
      0,
      0,
      1,
    )
  ).wait();
  const inviteEvent = inviteReceipt!.logs
    .map((log) => {
      try { return identity.interface.parseLog(log); } catch { return null; }
    })
    .find((item) => item?.name === "IdentityCreated");
  const inviteIdentityId = inviteEvent!.args.identityId;
  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = latestBlock!.timestamp + 3600;
  const nonce = ethers.id(`smoke-invite-${suffix}`);
  const network = await ethers.provider.getNetwork();
  const voucherSignature = await owner.signTypedData(
    {
      name: "EYEKON Identity",
      version: "2",
      chainId: network.chainId,
      verifyingContract: deployment.contracts.IdentityNFT,
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
      identityId: inviteIdentityId,
      authorizedClaimant: claimant.address,
      nonce,
      deadline,
    },
  );
  await (
    await identity
      .connect(claimant)
      .claimIdentity(
        inviteIdentityId,
        claimant.address,
        nonce,
        deadline,
        voucherSignature,
      )
  ).wait();

  const credentialHash = ethers.id(`smoke-credential-${suffix}`);
  const credentialReceipt = await (
    await credential.issueCredential(
      organizationId,
      claimant.address,
      credentialHash,
      1,
      0,
      false,
    )
  ).wait();

  await (
    await payment.configureRoyalty(
      identityId,
      500,
      [owner.address, claimant.address],
      [7000, 3000],
    )
  ).wait();

  console.log(
    JSON.stringify({
      organizationId: organizationId.toString(),
      identityId: identityId.toString(),
      inviteIdentityId: inviteIdentityId.toString(),
      claimant: claimant.address,
      credentialTransaction: credentialReceipt!.hash,
      publicClaimBalance: (
        await identity.balanceOfIdentity(claimant.address, identityId)
      ).toString(),
      inviteClaimBalance: (
        await identity.balanceOfIdentity(claimant.address, inviteIdentityId)
      ).toString(),
      credentialCount: (
        await credential.getRecipientCredentialCount(claimant.address)
      ).toString(),
      royaltyConfigured: await payment.isRoyaltyConfigured(identityId),
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
