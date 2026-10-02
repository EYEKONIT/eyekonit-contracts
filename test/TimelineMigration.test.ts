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
    await expect(replacement.connect(creator).createTimeline(1,'New','QA',2,0)).to.be.revertedWith('Import legacy timelines first');
    await replacement.importLegacyTimeline(1);
    expect(await replacement.getTimeline(1)).to.deep.equal(await legacy.getTimeline(1));
    expect(await replacement.getChapter(1,1)).to.deep.equal(await legacy.getChapter(1,1));
    expect(await replacement.identityToChapter(1,1)).to.equal(1);
    await expect(replacement.importLegacyTimeline(1)).to.be.revertedWith('Import sequential legacy IDs');
    await replacement.connect(creator).createTimeline(1,'New','QA',2,0);expect((await replacement.getTimeline(2)).creator).to.equal(creator.address);
  });
  it('rejects migration that would erase a holder’s existing completion history',async()=>{
    const {holder,nft,replacement}=await fixture();await nft.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');
    await expect(replacement.importLegacyTimeline(1)).to.be.revertedWith('Existing progress requires migration');
  });
  it('retains an existing NFT timeline link after the replacement is configured',async()=>{
    const {holder,nft,replacement}=await fixture();await replacement.importLegacyTimeline(1);await nft.setTimelineContract(await replacement.getAddress());
    await nft.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');
    expect((await replacement.getUserProgress(1,holder.address))[1]).to.equal(1);expect(await nft.identityToTimeline(1)).to.equal(1);
  });
});
