import {expect} from 'chai';
import {ethers} from 'hardhat';

describe('Standard identities V4: immutable definitions and approved private claims',()=>{
 async function fixture(){
  const [owner,creator,holder,other]=await ethers.getSigners();
  const access=await(await ethers.getContractFactory('EyekonAccessControl')).deploy();
  await access.connect(creator).registerOrganization('Standard identity QA');
  const nft=await(await ethers.getContractFactory('IdentityNFTV4')).deploy(await access.getAddress(),ethers.ZeroAddress);
  const splitter=await(await ethers.getContractFactory('PaymentSplitterV2')).deploy(await nft.getAddress());
  await nft.setPaymentSplitter(await splitter.getAddress());
  async function voucher(id:number,who=holder.address,deadline=Math.floor(Date.now()/1000)+3600,signer=creator){
    const nonce=ethers.hexlify(ethers.randomBytes(32));
    const signature=await signer.signTypedData({name:'EYEKON Identity',version:'2',chainId:(await ethers.provider.getNetwork()).chainId,verifyingContract:await nft.getAddress()},{ClaimVoucher:[{name:'identityId',type:'uint256'},{name:'authorizedClaimant',type:'address'},{name:'nonce',type:'bytes32'},{name:'deadline',type:'uint256'}]},{identityId:id,authorizedClaimant:who,nonce,deadline});
    return [id,who,nonce,deadline,signature] as const;
  }
  return {owner,creator,holder,other,access,nft,splitter,voucher};
 }
 it('creates standard personal and organization definitions, requires organization authority and rejects duplicate names',async()=>{
  const {creator,holder,nft}=await fixture();
  await nft.connect(creator).createIdentity('Personal standard',0,'ipfs://personal',2,0,false,0,0,0);
  await nft.connect(creator).createIdentity('Organization standard',1,'ipfs://org',2,1000,true,0,0,0);
  expect((await nft.getIdentity(1)).organizationId).to.equal(0);expect((await nft.getIdentity(2)).organizationId).to.equal(1);
  expect(await nft.isEvolutionIdentity(1)).to.equal(false);
  await expect(nft.connect(holder).createIdentity('Denied org',1,'ipfs://no',1,0,false,0,0,0)).to.be.revertedWith('Not an organization owner or admin');
  await expect(nft.connect(creator).createIdentity('PERSONAL STANDARD',0,'ipfs://dup',1,0,false,0,0,0)).to.be.revertedWith('Identity name already exists');
 });
 it('locks all standard definition fields for creators, organization owners and the deployer immediately',async()=>{
  const {owner,creator,nft}=await fixture();
  await nft.connect(creator).createIdentity('Immutable standard',1,'ipfs://fixed',3,1000,true,0,0,0);
  const before=await nft.getIdentity(1);
  for(const signer of [owner,creator])for(const action of [()=>nft.connect(signer).setPrice(1,0),()=>nft.connect(signer).setSupplyLimit(1,100),()=>nft.connect(signer).updateMetadataURI(1,'ipfs://changed'),()=>nft.connect(signer).setIdentityActive(1,false)])await expect(action()).to.be.revertedWith('Published identity is immutable');
  expect(await nft.getIdentity(1)).to.deep.equal(before);
 });
 it('private standard recipients need a wallet-bound creator approval and receive the exact 80/20 sale',async()=>{
  const {creator,holder,other,nft,splitter,voucher}=await fixture();
  await nft.connect(creator).createIdentity('Private paid standard',1,'ipfs://private',3,1000,false,0,0,2);
  const v=await voucher(1);
  await expect(nft.connect(other).claimIdentity(...v,{value:1000})).to.be.revertedWith('Invitation is for another wallet');
  await expect(nft.connect(holder).claimIdentity(...await voucher(1,ethers.ZeroAddress),{value:1000})).to.be.revertedWith('Private invitation must name a wallet');
  await expect(nft.connect(holder).claimIdentity(...await voucher(1,holder.address,1),{value:1000})).to.be.revertedWith('Invitation expired');
  await expect(nft.connect(holder).claimIdentity(...await voucher(1,holder.address,Math.floor(Date.now()/1000)+3600,other),{value:1000})).to.be.revertedWith('Invalid invitation signature');
  await expect(nft.connect(holder).claimIdentity(...v,{value:999})).to.be.revertedWith('Insufficient payment');
  const platform=await splitter.PLATFORM_WALLET(),beforeOwner=await ethers.provider.getBalance(creator.address),beforePlatform=await ethers.provider.getBalance(platform);
  await nft.connect(holder).claimIdentity(...v,{value:1000});
  expect(await ethers.provider.getBalance(creator.address)-beforeOwner).to.equal(800);expect(await ethers.provider.getBalance(platform)-beforePlatform).to.equal(200);
  expect(await nft.ownerOf(1)).to.equal(holder.address);
  await expect(nft.connect(holder).claimIdentity(...v,{value:1000})).to.be.revertedWith('Invitation already used');
 });
 it('free private claims and public sold-out claims preserve zero revenue, exact supply and current unique holders',async()=>{
  const {creator,holder,other,nft,splitter,voucher}=await fixture();
  await nft.connect(creator).createIdentity('Private free standard',0,'ipfs://free',1,0,false,0,0,2);
  const before=await ethers.provider.getBalance(await splitter.PLATFORM_WALLET());await nft.connect(holder).claimIdentity(...await voucher(1));
  expect(await ethers.provider.getBalance(await splitter.PLATFORM_WALLET())).to.equal(before);
  await expect(nft.connect(other).claimIdentity(...await voucher(1,other.address))).to.be.revertedWith('Supply limit reached');
  await nft.connect(holder).transferFrom(holder.address,other.address,1);
  expect(await nft.balanceOfIdentity(holder.address,1)).to.equal(0);expect(await nft.balanceOfIdentity(other.address,1)).to.equal(1);
  expect(await nft.getHolders(1)).to.deep.equal([other.address]);
 });
 it('current organization admins can approve invitations and departed creators lose signing and issuance authority',async()=>{
  const {creator,holder,other,access,nft,voucher}=await fixture();
  await access.connect(creator).addOrganizationMember(1,other.address,await access.ORG_ADMIN_ROLE());
  await nft.connect(other).createIdentity('Admin-created private standard',1,'ipfs://admin',3,0,false,0,0,2);
  await nft.connect(holder).claimIdentity(...await voucher(1,holder.address,Math.floor(Date.now()/1000)+3600,creator));
  const departedVoucher=await voucher(1,holder.address,Math.floor(Date.now()/1000)+3600,other);
  await access.connect(creator).removeOrganizationMember(1,other.address);
  expect(await nft.canManageIdentity(1,other.address)).to.equal(false);
  await expect(nft.connect(other).mintIdentity(holder.address,1)).to.be.revertedWith('Not authorized to mint');
  await expect(nft.connect(holder).claimIdentity(...departedVoucher)).to.be.revertedWith('Invalid invitation signature');
  await nft.connect(holder).claimIdentity(...await voucher(1));
 });
 it('imports existing standard and evolution definitions, unclaimed genuine definitions and token ownership without changing IDs or metadata',async()=>{
  const [owner,creator,holder]=await ethers.getSigners();
  const access=await(await ethers.getContractFactory('EyekonAccessControl')).deploy();
  const oldNFT=await(await ethers.getContractFactory('IdentityNFTV3')).deploy(await access.getAddress(),ethers.ZeroAddress);
  await oldNFT.connect(creator).createIdentity('Existing standard',0,'ipfs://existing',3,0,false,0,0,0);
  await oldNFT.connect(creator).createEvolutionIdentity('Unlinked evolution',0,'ipfs://evolution',1,0,false,0,0,0);
  await oldNFT.connect(creator).createIdentity('Genuine unclaimed',0,'ipfs://genuine',10,0,false,0,0,0);
  await oldNFT.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');
  const nft=await(await ethers.getContractFactory('IdentityNFTV4')).deploy(await access.getAddress(),await oldNFT.getAddress());
  for(let id=1;id<=3;id++)await nft.importLegacyIdentity(id);
  expect(await nft.isEvolutionIdentity(2)).to.equal(true);
  await expect(nft.finalizeMigration()).to.be.revertedWith('Migration incomplete');
  await oldNFT.connect(holder)['safeTransferFrom(address,address,uint256)'](holder.address,await nft.getAddress(),1);
  await nft.finalizeMigration();
  for(let id=1;id<=3;id++)expect(await nft.getIdentity(id)).to.deep.equal(await oldNFT.getIdentity(id));
  expect(await nft.ownerOf(1)).to.equal(holder.address);expect(await oldNFT.ownerOf(1)).to.equal(await nft.getAddress());
  expect(await nft.tokenURI(1)).to.equal('ipfs://existing');expect(await nft.getTotalIdentities()).to.equal(3);expect(await nft.getTotalTokens()).to.equal(1);
  await expect(nft.connect(owner).updateMetadataURI(3,'ipfs://wrong')).to.be.revertedWith('Published identity is immutable');
 });
 it('allows holder recovery before finalization and refuses changed source definitions',async()=>{
  const {creator,holder,other,access}=await fixture();
  const oldNFT=await(await ethers.getContractFactory('IdentityNFTV3')).deploy(await access.getAddress(),ethers.ZeroAddress);
  await oldNFT.connect(creator).createIdentity('Recoverable',0,'ipfs://old',2,0,false,0,0,0);await oldNFT.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');
  const nft=await(await ethers.getContractFactory('IdentityNFTV4')).deploy(await access.getAddress(),await oldNFT.getAddress());await nft.importLegacyIdentity(1);
  await oldNFT.connect(creator).setPrice(1,1);await expect(oldNFT.connect(holder)['safeTransferFrom(address,address,uint256)'](holder.address,await nft.getAddress(),1)).to.be.revertedWith('Import unchanged identity first');
  await oldNFT.connect(creator).setPrice(1,0);await oldNFT.connect(holder)['safeTransferFrom(address,address,uint256)'](holder.address,await nft.getAddress(),1);
  await expect(nft.connect(other).recoverLegacyToken(1)).to.be.revertedWith('Only holder before finalization');
  await nft.connect(holder).recoverLegacyToken(1);expect(await oldNFT.ownerOf(1)).to.equal(holder.address);expect(await nft.migratedTokenCount()).to.equal(0);
 });
 it('preserves personal timeline chapters and historical progress in the coordinated migration',async()=>{
  const [owner,creator,holder]=await ethers.getSigners();
  const access=await(await ethers.getContractFactory('EyekonAccessControl')).deploy(),empty=await(await ethers.getContractFactory('TimelineV2')).deploy(await access.getAddress());
  const oldTimeline=await(await ethers.getContractFactory('TimelineV4')).deploy(await access.getAddress(),await empty.getAddress()),oldNFT=await(await ethers.getContractFactory('IdentityNFTV3')).deploy(await access.getAddress(),ethers.ZeroAddress);
  await oldTimeline.setIdentityContract(await oldNFT.getAddress());await oldNFT.setTimelineContract(await oldTimeline.getAddress());
  await oldTimeline.connect(creator).createTimeline(0,'Preserved personal journey','Original',2,25);await oldNFT.connect(creator).createEvolutionIdentity('Original opening',0,'ipfs://original',2,0,false,0,0,0);await oldTimeline.connect(creator).addChapter(1,1,1,false);await oldNFT.connect(creator).linkIdentityToTimeline(1,1);await oldNFT.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');
  const nft=await(await ethers.getContractFactory('IdentityNFTV4')).deploy(await access.getAddress(),await oldNFT.getAddress()),timeline=await(await ethers.getContractFactory('TimelineV5')).deploy(await access.getAddress(),await oldTimeline.getAddress());
  await nft.importLegacyIdentity(1);await timeline.importLegacyTimeline(1);await nft.setTimelineContract(await timeline.getAddress());await timeline.setIdentityContract(await nft.getAddress());await oldNFT.setTimelineContract(await timeline.getAddress());await timeline.importLegacyProgress(1,holder.address);
  await oldNFT.connect(holder)['safeTransferFrom(address,address,uint256)'](holder.address,await nft.getAddress(),1);await nft.finalizeMigration();await timeline.finalizeMigration();
  expect(await timeline.getTimeline(1)).to.deep.equal(await oldTimeline.getTimeline(1));expect(await timeline.getChapter(1,1)).to.deep.equal(await oldTimeline.getChapter(1,1));expect(await timeline.getUserProgress(1,holder.address)).to.deep.equal(await oldTimeline.getUserProgress(1,holder.address));
  await nft.connect(holder).claimIdentity(1,ethers.ZeroAddress,ethers.ZeroHash,0,'0x');expect((await timeline.getUserProgress(1,holder.address))[1]).to.equal(1);
  await expect(timeline.connect(creator).updateTimeline(1,'Wrong','Wrong',0,false)).to.be.revertedWith('Published timeline information is immutable');
 });
});
