import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('Immutable organization registry and compatible permissions', () => {
  async function setup() {
    const [deployer, owner, admin, member, outsider] = await ethers.getSigners();
    const legacy = await (await ethers.getContractFactory('EyekonAccessControl')).deploy();
    const registry = await (await ethers.getContractFactory('OrganizationRegistryV2')).deploy(await legacy.getAddress());
    return { deployer, owner, admin, member, outsider, legacy, registry };
  }
  it('keeps organization metadata immutable through both contract addresses', async () => {
    const { owner, legacy, registry } = await setup();
    await registry.connect(owner).registerOrganization('Immutable QA');
    const backing = await legacy.getOrganization(1);
    expect(backing.owner).to.equal(await registry.getAddress());
    expect((await registry.getOrganization(1)).owner).to.equal(owner.address);
    expect(await registry.getMemberRole(1, owner.address)).to.equal(await registry.ORG_OWNER_ROLE());
    expect(await legacy.isOrganizationAdminOrOwner(1, owner.address)).to.equal(true);
    await expect(registry.connect(owner).updateOrganizationName(1, 'Other')).to.be.revertedWith('Published organization information is immutable');
    await expect(legacy.connect(owner).updateOrganizationName(1, 'Other')).to.be.revertedWith('Only owner can update organization name');
    await expect(registry.connect(owner).deactivateOrganization(1)).to.be.revertedWith('Published organizations cannot be deleted');
    await expect(legacy.connect(owner).deactivateOrganization(1)).to.be.revertedWith('Only owner can deactivate organization');
  });
  it('registers nested departments without inheriting private team permissions', async () => {
    const { owner, admin, member, legacy, registry } = await setup();
    await registry.connect(owner).registerOrganization('Company QA');
    await registry.connect(owner).addOrganizationMember(1, admin.address, await registry.ORG_ADMIN_ROLE());
    await registry.connect(owner).addOrganizationMember(1, member.address, await registry.ORG_MEMBER_ROLE());
    await registry.connect(admin).registerSubOrganization('HR QA', 1);
    await registry.connect(admin).registerSubOrganization('Recruitment QA', 2);
    expect(await registry.parentOrganizationIds(2)).to.equal(1);
    expect(await registry.parentOrganizationIds(3)).to.equal(2);
    expect(await registry.getMemberRole(2, owner.address)).to.equal(ethers.ZeroHash);
    expect(await legacy.isOrganizationAdminOrOwner(2, admin.address)).to.equal(true);
    await expect(registry.connect(member).registerSubOrganization('Forbidden QA', 1)).to.be.revertedWith('Not a parent owner or admin');
    await expect(registry.connect(admin).registerSubOrganization('Missing QA', 999)).to.be.revertedWith('Parent is not registered');
  });
  it('preserves member, admin and ownership transitions in the existing role ledger', async () => {
    const { owner, admin, member, outsider, legacy, registry } = await setup();
    await registry.connect(owner).registerOrganization('Roles QA');
    await registry.connect(owner).addOrganizationMember(1, admin.address, await registry.ORG_ADMIN_ROLE());
    await registry.connect(admin).addOrganizationMember(1, member.address, await registry.ORG_MEMBER_ROLE());
    await expect(registry.connect(admin).updateMemberRole(1, member.address, await registry.ORG_ADMIN_ROLE())).to.be.revertedWith('Only owner can update roles');
    await expect(registry.connect(member).addOrganizationMember(1, outsider.address, await registry.ORG_MEMBER_ROLE())).to.be.revertedWith('Only owner or admin can add members');
    await registry.connect(owner).transferOrganizationOwnership(1, member.address);
    expect((await registry.getOrganization(1)).owner).to.equal(member.address);
    expect(await registry.getMemberRole(1, owner.address)).to.equal(await registry.ORG_ADMIN_ROLE());
    expect(await legacy.isOrganizationAdminOrOwner(1, member.address)).to.equal(true);
    await expect(registry.connect(member).removeOrganizationMember(1, member.address)).to.be.revertedWith('Cannot remove owner');
    await registry.connect(member).removeOrganizationMember(1, admin.address);
    expect(await legacy.isOrganizationAdminOrOwner(1, admin.address)).to.equal(false);
    expect(await registry.isOrganizationAdminOrOwner(1, admin.address)).to.equal(false);
  });
  it('adopts existing definitions only with legacy owner authority and exact immutable snapshot', async () => {
    const { owner, outsider, legacy, registry } = await setup();
    await legacy.connect(owner).registerOrganization('Existing QA');
    const original = await legacy.getOrganization(1);
    await expect(registry.connect(outsider).prepareLegacyAdoption(1)).to.be.revertedWith('Only legacy owner');
    await registry.connect(owner).prepareLegacyAdoption(1);
    await expect(registry.finalizeLegacyAdoption(1)).to.be.revertedWith('Backing ownership not transferred');
    await legacy.connect(owner).addOrganizationMember(1, await registry.getAddress(), await legacy.ORG_ADMIN_ROLE());
    await legacy.connect(owner).transferOrganizationOwnership(1, await registry.getAddress());
    await registry.finalizeLegacyAdoption(1);
    expect((await registry.getOrganization(1)).name).to.equal(original.name);
    expect((await registry.getOrganization(1)).createdAt).to.equal(original.createdAt);
    expect((await registry.getOrganization(1)).owner).to.equal(owner.address);
    expect(await registry.getOrganizationMembers(1)).to.deep.equal([owner.address]);
    await expect(registry.finalizeLegacyAdoption(1)).to.be.revertedWith('No pending adoption');
    await expect(legacy.connect(owner).updateOrganizationName(1, 'Change')).to.be.revertedWith('Only owner can update organization name');
  });
  it('rejects adoption of changed metadata and invalid membership or ownership targets', async () => {
    const { owner, legacy, registry } = await setup();
    await legacy.connect(owner).registerOrganization('Original QA');
    await registry.connect(owner).prepareLegacyAdoption(1);
    await legacy.connect(owner).updateOrganizationName(1, 'Changed QA');
    await legacy.connect(owner).addOrganizationMember(1, await registry.getAddress(), await legacy.ORG_ADMIN_ROLE());
    await legacy.connect(owner).transferOrganizationOwnership(1, await registry.getAddress());
    await expect(registry.finalizeLegacyAdoption(1)).to.be.revertedWith('Organization definition changed');
    await registry.connect(owner).registerOrganization('Valid QA');
    await expect(registry.connect(owner).addOrganizationMember(2, ethers.ZeroAddress, await registry.ORG_MEMBER_ROLE())).to.be.revertedWith('Invalid member');
    await expect(registry.connect(owner).transferOrganizationOwnership(2, await registry.getAddress())).to.be.revertedWith('Invalid new owner');
  });
  it('lists unique current memberships after removal and re-addition', async () => {
    const { owner, member, registry } = await setup();
    await registry.connect(owner).registerOrganization('Membership QA');
    await registry.connect(owner).addOrganizationMember(1, member.address, await registry.ORG_MEMBER_ROLE());
    await registry.connect(owner).removeOrganizationMember(1, member.address);
    expect(await registry.getUserOrganizations(member.address)).to.deep.equal([]);
    await registry.connect(owner).addOrganizationMember(1, member.address, await registry.ORG_MEMBER_ROLE());
    expect(await registry.getUserOrganizations(member.address)).to.deep.equal([1n]);
  });
  it('keeps existing identity and credential consumer contracts authorized by the backing ledger', async () => {
    const { owner, admin, member, legacy, registry } = await setup();
    const nft = await (await ethers.getContractFactory('IdentityNFTV3')).deploy(await legacy.getAddress(), ethers.ZeroAddress);
    const credentials = await (await ethers.getContractFactory('CredentialRegistryV5')).deploy(await legacy.getAddress());
    await registry.connect(owner).registerOrganization('Compatible QA');
    await registry.connect(owner).addOrganizationMember(1, admin.address, await registry.ORG_ADMIN_ROLE());
    await nft.connect(owner).createIdentity('Stable identity', 1, 'ipfs://stable', 2, 0, true, 0, 0, 0);
    expect((await nft.getIdentity(1)).creator).to.equal(owner.address);
    const hash = ethers.keccak256(ethers.toUtf8Bytes('credential QA'));
    await credentials.connect(admin).issueCredential(1, member.address, hash, 1, 0, false);
    await registry.connect(owner).removeOrganizationMember(1, admin.address);
    await expect(credentials.connect(admin).issueCredential(1, member.address, hash, 1, 0, false)).to.be.revertedWith('Not an organization owner or admin');
    await credentials.connect(owner).issueCredential(1, member.address, hash, 1, 0, false);
    expect((await nft.getIdentity(1)).metadataURI).to.equal('ipfs://stable');
  });
});
