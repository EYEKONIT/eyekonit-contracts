import {expect} from 'chai';
import {ethers} from 'hardhat';
import {takeSnapshot} from '@nomicfoundation/hardhat-network-helpers';

describe('CredentialRegistry V5 current organization authority',function(){
  let snapshot:Awaited<ReturnType<typeof takeSnapshot>>;
  beforeEach(async()=>{snapshot=await takeSnapshot();});
  afterEach(async()=>{await snapshot.restore();});
  it('removes revocation authority from a departed issuer and preserves current owner authority',async()=>{
    const [owner,admin,recipient]=await ethers.getSigners();
    const access=await(await ethers.getContractFactory('EyekonAccessControl')).deploy();await access.registerOrganization('Authority QA');
    await access.addOrganizationMember(1,admin.address,await access.ORG_ADMIN_ROLE());
    const registry=await(await ethers.getContractFactory('CredentialRegistryV5')).deploy(await access.getAddress());
    const receipt=await(await registry.connect(admin).issueCredentialWithDuration(1,recipient.address,ethers.keccak256(ethers.toUtf8Bytes('Synthetic authority fixture')),1,86400,true)).wait();
    const event=receipt!.logs.map(log=>{try{return registry.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='CredentialIssued')!;
    const id=event.args.attestationId;
    await access.removeOrganizationMember(1,admin.address);
    await expect(registry.connect(admin).revokeCredential(id,'Former staff')).to.be.revertedWith('Not authorized to revoke');
    expect(await registry.isCredentialValid(id)).to.equal(true);
    await registry.connect(owner).revokeCredential(id,'Current owner QA action');
    expect(await registry.isCredentialValid(id)).to.equal(false);
    expect((await registry.getAttestation(id)).issuer).to.equal(admin.address);
    expect(await registry.getRecipientCredentialCount(recipient.address)).to.equal(1n);
  });
  it('preserves full mined-time durations and nonduplicating transfer views',async()=>{
    const [,first,second]=await ethers.getSigners();const access=await(await ethers.getContractFactory('EyekonAccessControl')).deploy();await access.registerOrganization('Final duration QA');
    const registry=await(await ethers.getContractFactory('CredentialRegistryV5')).deploy(await access.getAddress());
    const receipt=await(await registry.issueCredentialWithDuration(1,first.address,ethers.keccak256(ethers.toUtf8Bytes('Synthetic final duration')),1,86400,true)).wait();
    const event=receipt!.logs.map(log=>{try{return registry.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='CredentialIssued')!;
    const id=event.args.attestationId,record=await registry.getAttestation(id);expect(record.expiresAt-record.issuedAt).to.equal(86400n);
    await registry.connect(first).transferCredential(id,second.address);await registry.connect(second).transferCredential(id,first.address);
    expect(await registry.getCredentialsByRecipient(first.address)).to.deep.equal([id]);expect(await registry.getRecipientCredentialCount(second.address)).to.equal(0n);
  });
});
