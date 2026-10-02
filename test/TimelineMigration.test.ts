import { expect } from 'chai';
import { ethers } from 'hardhat';
describe('Timeline pre-launch migration',function(){
  async function fixture(){
    const [owner,creator,holder]=await ethers.getSigners();
    const access=await (await ethers.getContractFactory('EyekonAccessControl')).deploy();
    const nft=await (await ethers.getContractFactory('IdentityNFTV2')).deploy(await access.getAddress());
    const legacy=await (await ethers.getContractFactory('TimelineV2')).deploy(await access.getAddress());
    await access.connect(creator).registerOrganization('Migration QA');await legacy.setIdentityContract(await nft.getAddress());await nft.setTimelineContract(await legacy.getAddress());
    await legacy.connect(creator).createTimeline(1,'Existing QA','Original metadata',2,10);
    await nft.connect(creator).createIdentity('Existing chapter',1,'ipfs://qa',5,0,true,0,0,0);
    await legacy.connect(creator).addChapter(1,1,1,false);await nft.connect(creator).linkIdentityToTimeline(1,1);
    const replacement=await (await ethers.getContractFactory('TimelineV3')).deploy(await access.getAddress(),await legacy.getAddress());
    await replacement.setIdentityContract(await nft.getAddress());
    return {owner,creator,holder,access,nft,legacy,replacement};
  }
  it('preserves original ID, creator, timestamps, chapter links and subsequent ID allocation',async()=>{
    const {creator,legacy,replacement}=await fixture();
    await expect(replacement.connect(creator).importLegacyTimeline(1)).to.be.reverted;
    await expect(replacement.connect(creator).createTimeline(1,'New','QA',2,0)).to.be.revertedWith('Migration incomplete');
    await replacement.importLegacyTimeline(1);
    expect(await replacement.getTimeline(1)).to.deep.equal(await legacy.getTimeline(1));
    expect(await replacement.getChapter(1,1)).to.deep.equal(await legacy.getChapter(1,1));
    expect(await replacement.identityToChapter(1,1)).to.equal(1);
    await expect(replacement.importLegacyTimeline(1)).to.be.revertedWith('Import sequential legacy IDs');
    await (await ethers.getContractAt('IdentityNFTV2',await replacement.identityContract())).setTimelineContract(await replacement.getAddress());
    await replacement.finalizeMigration();
    await replacement.connect(creator).createTimeline(1,'New','QA',2,0);expect((await replacement.getTimeline(2)).creator).to.equal(creator.address);
  });
  it('preserves legacy progress and refuses activation until all users have been imported',async()=>{
    const {holder,nft,legacy,replacement}=await fixture();await nft.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');
    await replacement.importLegacyTimeline(1);await nft.setTimelineContract(await replacement.getAddress());
    await expect(nft.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x')).to.be.revertedWith('Migration incomplete');
    await expect(replacement.finalizeMigration()).to.be.revertedWith('Legacy progress not fully imported');
    await replacement.importLegacyProgress(1,holder.address);
    expect(await replacement.getUserProgress(1,holder.address)).to.deep.equal(await legacy.getUserProgress(1,holder.address));
    expect(await replacement.userProgress(1,holder.address)).to.deep.equal(await legacy.userProgress(1,holder.address));
    await expect(replacement.importLegacyProgress(1,holder.address)).to.be.revertedWith('Progress already imported');
    await replacement.finalizeMigration();await nft.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');
    expect((await replacement.getUserProgress(1,holder.address))[1]).to.equal(1);
  });
  it('retains an existing NFT timeline link after the replacement is configured',async()=>{
    const {holder,nft,replacement}=await fixture();await replacement.importLegacyTimeline(1);await nft.setTimelineContract(await replacement.getAddress());await replacement.finalizeMigration();
    await nft.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');
    expect((await replacement.getUserProgress(1,holder.address))[1]).to.equal(1);expect(await nft.identityToTimeline(1)).to.equal(1);
  });
  it('rejects unimported or mutated legacy metadata and progress from a wallet that never completed a chapter',async()=>{
    const {creator,holder,nft,legacy,replacement}=await fixture();await replacement.importLegacyTimeline(1);await nft.setTimelineContract(await replacement.getAddress());
    await expect(replacement.importLegacyProgress(1,holder.address)).to.be.revertedWith('No valid legacy progress');
    await legacy.connect(creator).updateTimeline(1,'Changed during migration','QA',10,true);
    await expect(replacement.finalizeMigration()).to.be.revertedWith('Legacy timeline changed');
  });
});
