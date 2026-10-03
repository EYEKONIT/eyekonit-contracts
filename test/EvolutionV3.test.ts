import {expect} from 'chai';
import {ethers} from 'hardhat';
describe('Evolution V3 immutable definitions and private invitation claims',function(){
 async function fixture(){
  const [owner,creator,holder,other]=await ethers.getSigners();
  const access=await(await ethers.getContractFactory('EyekonAccessControl')).deploy();
  await access.connect(creator).registerOrganization('Evolution V3 QA');
  const legacy=await(await ethers.getContractFactory('TimelineV2')).deploy(await access.getAddress());
  const timeline=await(await ethers.getContractFactory('TimelineV3')).deploy(await access.getAddress(),await legacy.getAddress());
  const nft=await(await ethers.getContractFactory('IdentityNFTV3')).deploy(await access.getAddress(),ethers.ZeroAddress);
  const splitter=await(await ethers.getContractFactory('PaymentSplitterV2')).deploy(await nft.getAddress());
  await nft.setTimelineContract(await timeline.getAddress());await nft.setPaymentSplitter(await splitter.getAddress());await timeline.setIdentityContract(await nft.getAddress());
  await timeline.connect(creator).createTimeline(1,'Private QA','Synthetic',2,25);
  await nft.connect(creator).createEvolutionIdentity('Private opening',1,'ipfs://private-1',3,1000,true,0,0,2);
  await timeline.connect(creator).addChapter(1,1,1,false);await nft.connect(creator).linkIdentityToTimeline(1,1);
  await nft.connect(creator).createEvolutionIdentity('Private continuation',1,'ipfs://private-2',3,1000,true,1,25,2);
  await timeline.connect(creator).addChapter(1,2,2,true);await nft.connect(creator).linkIdentityToTimeline(2,1);
  async function voucher(id:number,who=holder.address,deadline=Math.floor(Date.now()/1000)+3600,signer=creator){
   const nonce=ethers.hexlify(ethers.randomBytes(32));
   const signature=await signer.signTypedData({name:'EYEKON Identity',version:'2',chainId:(await ethers.provider.getNetwork()).chainId,verifyingContract:await nft.getAddress()},{ClaimVoucher:[{name:'identityId',type:'uint256'},{name:'authorizedClaimant',type:'address'},{name:'nonce',type:'bytes32'},{name:'deadline',type:'uint256'}]},{identityId:id,authorizedClaimant:who,nonce,deadline});
   return [id,who,nonce,deadline,signature] as const;
  }
  return {owner,creator,holder,other,nft,timeline,splitter,voucher};
 }
 it('private recipients pay exact prices and the discounted 80/20 split',async()=>{
  const {creator,holder,nft,splitter,voucher,timeline}=await fixture();
  const v=await voucher(1);await expect(nft.connect(holder).claimIdentity(...v,{value:999})).to.be.revertedWith('Insufficient payment');
  await nft.connect(holder).claimIdentity(...v,{value:1000});
  const platform=await splitter.PLATFORM_WALLET(),beforeOwner=await ethers.provider.getBalance(creator.address),beforePlatform=await ethers.provider.getBalance(platform);
  await nft.connect(holder).claimIdentity(...await voucher(2),{value:750});
  expect(await ethers.provider.getBalance(creator.address)-beforeOwner).to.equal(600);expect(await ethers.provider.getBalance(platform)-beforePlatform).to.equal(150);
  expect((await timeline.getUserProgress(1,holder.address))[2]).to.equal(true);
 });
 it('rejects absent, wrong-wallet, wrong-signer, expired, and replayed private vouchers',async()=>{
  const {holder,other,nft,voucher}=await fixture();
  await expect(nft.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x',{value:1000})).to.be.reverted;
  const v=await voucher(1);await expect(nft.connect(other).claimIdentity(...v,{value:1000})).to.be.revertedWith('Invitation is for another wallet');
  await expect(nft.connect(holder).claimIdentity(...await voucher(1,holder.address,1),{value:1000})).to.be.revertedWith('Invitation expired');
  await expect(nft.connect(holder).claimIdentity(...await voucher(1,holder.address,Math.floor(Date.now()/1000)+3600,other),{value:1000})).to.be.revertedWith('Invalid invitation signature');
  await nft.connect(holder).claimIdentity(...v,{value:1000});await expect(nft.connect(holder).claimIdentity(...v,{value:1000})).to.be.revertedWith('Invitation already used');
 });
 it('free private claims and 100 percent discounts need approval but no commission',async()=>{
  const {creator,holder,nft,voucher,splitter}=await fixture();
  await nft.connect(creator).createEvolutionIdentity('Free private',1,'ipfs://free',2,0,true,0,0,2);
  await nft.connect(holder).claimIdentity(...await voucher(3));
  await nft.connect(creator).createEvolutionIdentity('Full discount private',1,'ipfs://discount',2,1000,true,3,100,2);
  const before=await ethers.provider.getBalance(await splitter.PLATFORM_WALLET());await nft.connect(holder).claimIdentity(...await voucher(4));
  expect(await ethers.provider.getBalance(await splitter.PLATFORM_WALLET())).to.equal(before);
 });
 it('definitions are frozen immediately, links cannot change, and owner issuance respects sequence and progress',async()=>{
  const {creator,holder,other,nft,timeline}=await fixture();
  for(const action of [()=>nft.connect(creator).setPrice(1,0),()=>nft.connect(creator).setSupplyLimit(1,100),()=>nft.connect(creator).updateMetadataURI(1,'ipfs://changed'),()=>nft.connect(creator).setIdentityActive(1,false)])await expect(action()).to.be.revertedWith('Published evolution identity is immutable');
  await expect(nft.connect(creator).linkIdentityToTimeline(1,2)).to.be.revertedWith('Timeline link is immutable');
  await expect(nft.connect(creator).mintIdentity(holder.address,2)).to.be.revertedWith('Previous identity required');
  await nft.connect(creator).mintIdentity(holder.address,1);await nft.connect(creator).mintIdentity(holder.address,1);
  expect((await timeline.getUserProgress(1,holder.address))[1]).to.equal(1);
  await nft.connect(holder).transferFrom(holder.address,other.address,1);await nft.connect(creator).mintIdentity(other.address,2);
  expect((await timeline.getUserProgress(1,other.address))[0]).to.deep.equal([2n]);
 });
});

describe('Identity V3 holder-approved migration',function(){
 async function fixture(){
  const [owner,creator,holder,other]=await ethers.getSigners();const access=await(await ethers.getContractFactory('EyekonAccessControl')).deploy();
  const legacy=await(await ethers.getContractFactory('IdentityNFTV2')).deploy(await access.getAddress());
  await legacy.connect(creator).createIdentity('Legacy QA',0,'ipfs://legacy',3,0,true,0,0,0);
  await legacy.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');
  const nft=await(await ethers.getContractFactory('IdentityNFTV3')).deploy(await access.getAddress(),await legacy.getAddress());
  await nft.importLegacyIdentity(1);
  return {owner,creator,holder,other,access,legacy,nft};
 }
 it('preserves IDs, creator, metadata, holdings, supply and counters without leaving a transferable duplicate',async()=>{
  const {creator,holder,other,legacy,nft}=await fixture();
  await expect(nft.finalizeMigration()).to.be.revertedWith('Migration incomplete');
  await legacy.connect(holder)['safeTransferFrom(address,address,uint256)'](holder.address,await nft.getAddress(),1);
  expect(await nft.ownerOf(1)).to.equal(holder.address);expect(await legacy.ownerOf(1)).to.equal(await nft.getAddress());
  expect(await nft.tokenURI(1)).to.equal(await legacy.tokenURI(1));expect((await nft.getIdentity(1)).creator).to.equal(creator.address);
  await expect(nft.connect(holder).transferFrom(holder.address,other.address,1)).to.be.revertedWith('Migration incomplete');
  await nft.finalizeMigration();expect(await nft.getIdentity(1)).to.deep.equal(await legacy.getIdentity(1));
  await nft.connect(holder).transferFrom(holder.address,other.address,1);expect(await nft.balanceOfIdentity(other.address,1)).to.equal(1);expect(await nft.balanceOfIdentity(holder.address,1)).to.equal(0);
  await expect(nft.connect(other).recoverLegacyToken(1)).to.be.revertedWith('Only holder before finalization');
  await nft.connect(creator).createIdentity('Next QA',0,'ipfs://next',2,0,true,0,0,0);await nft.connect(holder).claimIdentity(2,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');expect(await nft.ownerOf(2)).to.equal(holder.address);
 });
 it('lets the holder recover the original before finalization and prevents a third party from taking it',async()=>{
  const {holder,other,legacy,nft}=await fixture();await legacy.connect(holder)['safeTransferFrom(address,address,uint256)'](holder.address,await nft.getAddress(),1);
  await expect(nft.connect(other).recoverLegacyToken(1)).to.be.revertedWith('Only holder before finalization');
  await nft.connect(holder).recoverLegacyToken(1);expect(await legacy.ownerOf(1)).to.equal(holder.address);expect(await nft.balanceOfIdentity(holder.address,1)).to.equal(0);expect(await nft.migratedTokenCount()).to.equal(0);
  await legacy.connect(holder)['safeTransferFrom(address,address,uint256)'](holder.address,await nft.getAddress(),1);await nft.finalizeMigration();expect(await nft.ownerOf(1)).to.equal(holder.address);
 });
 it('refuses changed definitions or a new legacy token rather than dropping data',async()=>{
  const {creator,holder,legacy,nft}=await fixture();await legacy.connect(creator).setPrice(1,1);
  await expect(legacy.connect(holder)['safeTransferFrom(address,address,uint256)'](holder.address,await nft.getAddress(),1)).to.be.revertedWith('Import unchanged identity first');
  await legacy.connect(creator).setPrice(1,0);await legacy.connect(holder)['safeTransferFrom(address,address,uint256)'](holder.address,await nft.getAddress(),1);
  await legacy.connect(creator).mintIdentity(holder.address,1);await expect(nft.finalizeMigration()).to.be.revertedWith('Legacy counts changed');
 });
 it('imports original timeline progress alongside a replacement NFT registry and freezes legacy chapter claims',async()=>{
  const [owner,creator,holder]=await ethers.getSigners();const access=await(await ethers.getContractFactory('EyekonAccessControl')).deploy();await access.connect(creator).registerOrganization('Combined QA');
  const legacyNFT=await(await ethers.getContractFactory('IdentityNFTV2')).deploy(await access.getAddress());
  const legacyTimeline=await(await ethers.getContractFactory('TimelineV2')).deploy(await access.getAddress());await legacyTimeline.setIdentityContract(await legacyNFT.getAddress());await legacyNFT.setTimelineContract(await legacyTimeline.getAddress());
  await legacyTimeline.connect(creator).createTimeline(1,'Existing journey','Original',2,25);await legacyNFT.connect(creator).createIdentity('Original chapter',1,'ipfs://original',3,0,true,0,0,0);await legacyTimeline.connect(creator).addChapter(1,1,1,false);await legacyNFT.connect(creator).linkIdentityToTimeline(1,1);await legacyNFT.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');
  const nft=await(await ethers.getContractFactory('IdentityNFTV3')).deploy(await access.getAddress(),await legacyNFT.getAddress());const timeline=await(await ethers.getContractFactory('TimelineV3')).deploy(await access.getAddress(),await legacyTimeline.getAddress());
  await nft.importLegacyIdentity(1);await timeline.importLegacyTimeline(1);await nft.setTimelineContract(await timeline.getAddress());await timeline.setIdentityContract(await nft.getAddress());await legacyNFT.setTimelineContract(await timeline.getAddress());
  await expect(legacyNFT.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x')).to.be.revertedWith('Only identity contract');
  await timeline.importLegacyProgress(1,holder.address);await legacyNFT.connect(holder)['safeTransferFrom(address,address,uint256)'](holder.address,await nft.getAddress(),1);await nft.finalizeMigration();await timeline.finalizeMigration();
  expect(await timeline.getTimeline(1)).to.deep.equal(await legacyTimeline.getTimeline(1));expect(await timeline.getUserProgress(1,holder.address)).to.deep.equal(await legacyTimeline.getUserProgress(1,holder.address));expect(await nft.isEvolutionIdentity(1)).to.equal(true);
  await expect(nft.connect(creator).setPrice(1,1)).to.be.revertedWith('Published evolution identity is immutable');
  await nft.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');expect((await timeline.getUserProgress(1,holder.address))[1]).to.equal(1);
 });
});
