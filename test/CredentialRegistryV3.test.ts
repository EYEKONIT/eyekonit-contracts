import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time, takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';

describe('CredentialRegistry V3 mined-time duration', function () {
  let snapshot: Awaited<ReturnType<typeof takeSnapshot>>;
  beforeEach(async()=>{snapshot=await takeSnapshot();});
  afterEach(async()=>{await snapshot.restore();});
  async function fixture() {
    const [owner, recipient, second, outsider] = await ethers.getSigners();
    const access = await (await ethers.getContractFactory('EyekonAccessControl')).deploy();
    await access.registerOrganization('Duration QA');
    const registry = await (await ethers.getContractFactory('CredentialRegistryV3')).deploy(await access.getAddress());
    return { owner, recipient, second, outsider, registry };
  }
  const hash = ethers.keccak256(ethers.toUtf8Bytes('synthetic duration QA'));

  it('starts validity at the mined block despite an arbitrary browser delay, and expires at the exact boundary', async function () {
    const { recipient, registry } = await fixture();
    const preparedAt = await time.latest();
    await time.increase(600);
    const receipt = await (await registry.issueCredentialWithDuration(1, recipient.address, hash, 1, 86400, false)).wait();
    const event = receipt!.logs.map(log => { try { return registry.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === 'CredentialIssued')!;
    const attestation = await registry.getAttestation(event.args.attestationId);
    expect(attestation.issuedAt).to.be.greaterThan(BigInt(preparedAt + 599));
    expect(attestation.expiresAt - attestation.issuedAt).to.equal(86400n);
    await time.increaseTo(attestation.expiresAt - 1n);
    expect(await registry.isCredentialValid(attestation.id)).to.equal(true);
    await time.increaseTo(attestation.expiresAt);
    expect(await registry.isCredentialValid(attestation.id)).to.equal(false);
  });

  it('gives every batch recipient the same full duration', async function () {
    const { recipient, second, registry } = await fixture();
    const receipt = await (await registry.batchIssueCredentialsWithDuration(1, [recipient.address, second.address], [hash, hash], 1, 60, true)).wait();
    const events = receipt!.logs.map(log => { try { return registry.interface.parseLog(log); } catch { return null; } }).filter(log => log?.name === 'CredentialIssued');
    expect(events).to.have.length(2);
    for (const event of events) expect(event!.args.expiresAt - event!.args.issuedAt).to.equal(60n);
    expect(events[0]!.args.expiresAt).to.equal(events[1]!.args.expiresAt);
  });

  it('rejects zero duration and unauthorized issuers without issuing anything', async function () {
    const { recipient, outsider, registry } = await fixture();
    await expect(registry.issueCredentialWithDuration(1, recipient.address, hash, 1, 0, false)).to.be.revertedWith('Duration must be positive');
    await expect(registry.connect(outsider).issueCredentialWithDuration(1, recipient.address, hash, 1, 86400, false)).to.be.revertedWith('Not an organization owner or admin');
    await expect(registry.batchIssueCredentialsWithDuration(1, [recipient.address], [], 1, 86400, false)).to.be.revertedWith('Invalid batch');
  });

  it('preserves fixed-date, no-expiry, transfer and revocation behavior', async function () {
    const {recipient,second,registry}=await fixture();
    const receipt=await(await registry.issueCredential(1,recipient.address,hash,1,0,true)).wait();
    const event=receipt!.logs.map(log=>{try{return registry.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='CredentialIssued')!;
    await registry.connect(recipient).transferCredential(event.args.attestationId,second.address);
    expect((await registry.getAttestation(event.args.attestationId)).recipient).to.equal(second.address);
    await registry.revokeCredential(event.args.attestationId,'Synthetic QA revoke');
    expect(await registry.isCredentialValid(event.args.attestationId)).to.equal(false);
    await expect(registry.connect(second).transferCredential(event.args.attestationId,recipient.address)).to.be.revertedWith('Cannot transfer revoked credential');
    const fixed=BigInt(await time.latest())+60n;
    const fixedReceipt=await(await registry.issueCredential(1,recipient.address,hash,1,fixed,false)).wait();
    const fixedEvent=fixedReceipt!.logs.map(log=>{try{return registry.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='CredentialIssued')!;
    expect((await registry.getAttestation(fixedEvent.args.attestationId)).expiresAt).to.equal(fixed);
    await expect(registry.connect(recipient).transferCredential(fixedEvent.args.attestationId,second.address)).to.be.revertedWith('Credential is not transferable');
  });
});
