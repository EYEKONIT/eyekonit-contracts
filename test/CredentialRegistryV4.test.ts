import {expect} from 'chai';
import {ethers} from 'hardhat';
import {takeSnapshot} from '@nomicfoundation/hardhat-network-helpers';

describe('CredentialRegistry V4 current ownership views',function(){
  let snapshot:Awaited<ReturnType<typeof takeSnapshot>>;
  beforeEach(async()=>{snapshot=await takeSnapshot();});
  afterEach(async()=>{await snapshot.restore();});
  it('tracks current holdings without duplicates through repeated transfer cycles, including revoked records',async()=>{
    const [owner,first,second]=await ethers.getSigners();
    const access=await(await ethers.getContractFactory('EyekonAccessControl')).deploy();await access.registerOrganization('Ownership QA');
    const registry=await(await ethers.getContractFactory('CredentialRegistryV4')).deploy(await access.getAddress());
    const hash=ethers.keccak256(ethers.toUtf8Bytes('Synthetic ownership fixture'));
    const receipt=await(await registry.issueCredentialWithDuration(1,first.address,hash,1,86400,true)).wait();
    const event=receipt!.logs.map(log=>{try{return registry.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='CredentialIssued')!;
    const id=event.args.attestationId;
    expect(await registry.getRecipientCredentialCount(first.address)).to.equal(1n);
    for(let i=0;i<3;i++){
      await registry.connect(first).transferCredential(id,second.address);
      expect(await registry.getCredentialsByRecipient(first.address)).to.deep.equal([]);
      expect(await registry.getRecipientCredentialCount(first.address)).to.equal(0n);
      expect(await registry.getCredentialsByRecipient(second.address)).to.deep.equal([id]);
      await registry.connect(second).transferCredential(id,first.address);
      expect(await registry.getCredentialsByRecipient(first.address)).to.deep.equal([id]);
      expect(await registry.getRecipientCredentialCount(first.address)).to.equal(1n);
      expect(await registry.getRecipientCredentialCount(second.address)).to.equal(0n);
    }
    await registry.connect(owner).revokeCredential(id,'Synthetic QA revocation');
    expect(await registry.getCredentialsByRecipient(first.address)).to.deep.equal([id]);
    expect(await registry.isCredentialValid(id)).to.equal(false);
  });
  it('rejects self transfers without inflating holdings or emitting a transfer',async()=>{
    const [,first]=await ethers.getSigners();const access=await(await ethers.getContractFactory('EyekonAccessControl')).deploy();await access.registerOrganization('Self transfer QA');
    const registry=await(await ethers.getContractFactory('CredentialRegistryV4')).deploy(await access.getAddress());
    const receipt=await(await registry.issueCredential(1,first.address,ethers.keccak256(ethers.toUtf8Bytes('Synthetic self transfer')),1,0,true)).wait();
    const event=receipt!.logs.map(log=>{try{return registry.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='CredentialIssued')!;
    await expect(registry.connect(first).transferCredential(event.args.attestationId,first.address)).to.be.revertedWith('Cannot transfer to yourself');
    expect(await registry.getRecipientCredentialCount(first.address)).to.equal(1n);
  });
});
