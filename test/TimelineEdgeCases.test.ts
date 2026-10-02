import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('Timeline edition and transfer edge cases', function () {
  async function fixture({price=0n,discount=25}={}) {
    const [owner, firstHolder, incomingHolder] = await ethers.getSigners();
    const access = await (await ethers.getContractFactory('EyekonAccessControl')).deploy();
    const nft = await (await ethers.getContractFactory('IdentityNFTV2')).deploy(await access.getAddress());
    const payment = await (await ethers.getContractFactory('PaymentSplitterV2')).deploy(await nft.getAddress());
    await nft.setPaymentSplitter(await payment.getAddress());
    const legacy = await (await ethers.getContractFactory('TimelineV2')).deploy(await access.getAddress());
    const timeline = await (await ethers.getContractFactory('TimelineV3')).deploy(await access.getAddress(),await legacy.getAddress());
    await access.registerOrganization('Timeline QA');
    await timeline.setIdentityContract(await nft.getAddress()); await nft.setTimelineContract(await timeline.getAddress());
    await timeline.createTimeline(1,'QA journey','Two chapters',2,25);
    for(let chapter=1;chapter<=2;chapter++) {
      await nft.createIdentity(`QA chapter ${chapter}`,1,`ipfs://qa-${chapter}`,3,chapter===2?price:0,true,chapter===2?1:0,discount,0);
      await timeline.addChapter(1,chapter,chapter,chapter===2); await nft.linkIdentityToTimeline(chapter,1);
    }
    const claim=(user:any,id:number,value=0n)=>nft.connect(user).claimIdentity(id,ethers.ZeroAddress,ethers.ZeroHash,0,'0x',{value});
    return {owner,firstHolder,incomingHolder,nft,timeline,payment,claim};
  }
  it('allows the recipient of chapter one to claim chapter two without fabricated prior claim history',async()=>{
    const {firstHolder,incomingHolder,nft,timeline,claim}=await fixture();
    await claim(firstHolder,1); await nft.connect(firstHolder).transferFrom(firstHolder.address,incomingHolder.address,1);
    expect((await timeline.getUserProgress(1,incomingHolder.address))[1]).to.equal(0);
    await claim(incomingHolder,2);
    expect(await nft.balanceOfIdentity(incomingHolder.address,2)).to.equal(1);
    expect((await timeline.getUserProgress(1,incomingHolder.address))[0]).to.deep.equal([2n]);
    await expect(claim(firstHolder,2)).to.be.revertedWith('Previous identity required');
  });
  it('permits another edition without counting the same chapter twice',async()=>{
    const {firstHolder,timeline,claim}=await fixture();await claim(firstHolder,1);await claim(firstHolder,1);
    expect((await timeline.getUserProgress(1,firstHolder.address))[1]).to.equal(1);expect(await timeline.timelineHolderCount(1)).to.equal(1);
  });
  it('published timeline metadata and active state cannot be edited, while claims remain available',async()=>{
    const {firstHolder,timeline,claim}=await fixture(); const before=await timeline.getTimeline(1);
    await expect(timeline.updateTimeline(1,'Changed','Changed',0,false)).to.be.revertedWith('Published timeline information is immutable');
    expect(await timeline.getTimeline(1)).to.deep.equal(before);await claim(firstHolder,1);
  });
  it('rejects unsupported chapter plans and first-chapter dependencies',async()=>{
    const {timeline}=await fixture();await expect(timeline.createTimeline(1,'Too many','QA',101,0)).to.be.revertedWith('Invalid chapter plan');
    await timeline.createTimeline(1,'QA invalid dependency','QA',2,0);
    await expect(timeline.addChapter(2,1,50,true)).to.be.revertedWith('First chapter cannot require previous');
    await expect(timeline.addChapter(2,2,50,true)).to.be.revertedWith('Previous chapter missing');
  });
  it('pays 80/20 on the exact discounted price for an incoming previous-chapter holder',async()=>{
    const {owner,firstHolder,incomingHolder,nft,payment,claim}=await fixture({price:1000n,discount:25});
    await claim(firstHolder,1);await nft.connect(firstHolder).transferFrom(firstHolder.address,incomingHolder.address,1);
    const platform=await payment.PLATFORM_WALLET(),ownerBefore=await ethers.provider.getBalance(owner.address),platformBefore=await ethers.provider.getBalance(platform);
    await expect(claim(incomingHolder,2,749n)).to.be.revertedWith('Insufficient payment');
    await claim(incomingHolder,2,750n);
    expect((await ethers.provider.getBalance(owner.address))-ownerBefore).to.equal(600n);
    expect((await ethers.provider.getBalance(platform))-platformBefore).to.equal(150n);
  });
  it('a 100 percent holder discount charges no payment or commission',async()=>{
    const {firstHolder,nft,payment,claim}=await fixture({price:1000n,discount:100});await claim(firstHolder,1);
    const platform=await payment.PLATFORM_WALLET(),before=await ethers.provider.getBalance(platform);
    await claim(firstHolder,2);expect(await nft.balanceOfIdentity(firstHolder.address,2)).to.equal(1);expect(await ethers.provider.getBalance(platform)).to.equal(before);
  });
});
