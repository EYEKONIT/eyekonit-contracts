// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./AccessControl.sol";
import "./IdentityNFTV3.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IEyekonTimelineV4 {
    function completeChapterByIdentity(uint256 timelineId, uint256 identityId, address user) external;
    function identityToChapter(uint256 timelineId, uint256 identityId) external view returns (uint256);
}

interface IEyekonPaymentSplitterV4 {
    function isRoyaltyConfigured(uint256 identityId) external view returns (bool);
    function processPrimarySale(uint256 identityId) external payable;
}

contract IdentityNFTV4 is ERC721URIStorage, Ownable, ReentrancyGuard, EIP712, IERC721Receiver {
    function identityProtocolVersion() external pure returns (uint256) { return 4; }
    enum ClaimPolicy { Public, InviteOnly, Private }

    struct Identity {
        uint256 id;
        uint256 organizationId;
        address creator;
        bytes32 nameHash;
        string metadataURI;
        uint256 supply;
        uint256 maxSupply;
        uint256 price;
        bool isMultiEdition;
        bool isActive;
        uint256 requiredPreviousId;
        uint8 holderDiscount;
        ClaimPolicy claimPolicy;
        uint256 createdAt;
    }

    bytes32 public constant CLAIM_VOUCHER_TYPEHASH = keccak256(
        "ClaimVoucher(uint256 identityId,address authorizedClaimant,bytes32 nonce,uint256 deadline)"
    );

    IdentityNFTV3 public immutable legacyIdentity;
    uint256 public immutable legacyIdentityCount;
    uint256 public immutable legacyTokenCount;
    uint256 public migratedTokenCount;
    mapping(uint256 => bool) public retiredLegacyIdentities;
    mapping(uint256 => bool) public retiredLegacyTokens;
    uint256 public retiredLegacyTokenCount;
    event LegacyTestIdentityRetired(uint256 indexed identityId);
    bool public migrationComplete;
    mapping(uint256 => bytes32) public legacyIdentitySnapshot;
    mapping(uint256 => bool) public isEvolutionIdentity;
    event LegacyIdentityImported(uint256 indexed identityId);
    event LegacyTokenImported(uint256 indexed tokenId, uint256 indexed identityId, address indexed holder);
    event LegacyTokenRecovered(uint256 indexed tokenId, address indexed holder);
    modifier ready() { require(migrationComplete, "Migration incomplete"); _; }
    EyekonAccessControl public immutable accessControl;
    IEyekonTimelineV4 public timeline;
    IEyekonPaymentSplitterV4 public paymentSplitter;
    uint256 private _identityIdCounter;
    uint256 private _tokenIdCounter;

    mapping(uint256 => Identity) public identities;
    mapping(bytes32 => bool) public identityNameUsed;
    mapping(bytes32 => bool) public usedClaimVouchers;
    mapping(uint256 => uint256) public tokenToIdentity;
    mapping(uint256 => uint256) public identityToTimeline;
    mapping(uint256 => address[]) private _identityHolders;
    mapping(uint256 => mapping(address => uint256)) private _holderIndexPlusOne;
    mapping(address => mapping(uint256 => uint256)) public userIdentityBalance;

    event IdentityCreated(
        uint256 indexed identityId,
        uint256 indexed organizationId,
        address indexed creator,
        bytes32 nameHash,
        string metadataURI,
        uint256 maxSupply,
        uint256 price,
        bool isMultiEdition,
        uint256 requiredPreviousId,
        uint8 holderDiscount,
        ClaimPolicy claimPolicy,
        uint256 createdAt
    );
    event IdentityClaimed(uint256 indexed identityId, address indexed claimant, uint256 indexed tokenId, uint256 pricePaid);
    event IdentityMinted(uint256 indexed tokenId, uint256 indexed identityId, address indexed owner, uint256 editionNumber);
    event IdentityTimelineLinked(uint256 indexed identityId, uint256 indexed timelineId);
    event IdentityActiveStatusChanged(uint256 indexed identityId, bool isActive);
    event PriceUpdated(uint256 indexed identityId, uint256 newPrice);
    event SupplyLimitSet(uint256 indexed identityId, uint256 newLimit);
    event MetadataURIUpdated(uint256 indexed identityId, string newURI);

    constructor(address accessControlAddress, address legacyAddress, uint256[] memory retiredIdentityIds)
        ERC721("EYEKON Identity", "EYEKON")
        Ownable(msg.sender)
        EIP712("EYEKON Identity", "2")
    {
        require(accessControlAddress != address(0), "Invalid access control");
        accessControl = EyekonAccessControl(accessControlAddress);
        legacyIdentity = IdentityNFTV3(payable(legacyAddress));
        if (legacyAddress != address(0)) {
            require(address(legacyIdentity.accessControl()) == accessControlAddress, "Legacy access mismatch");
        }
        legacyIdentityCount = legacyAddress == address(0) ? 0 : legacyIdentity.getTotalIdentities();
        legacyTokenCount = legacyAddress == address(0) ? 0 : legacyIdentity.getTotalTokens();
        for (uint256 i; i < retiredIdentityIds.length; i++) {
            uint256 id = retiredIdentityIds[i];
            require(id > 0 && id <= legacyIdentityCount && !retiredLegacyIdentities[id], "Invalid retired identity");
            retiredLegacyIdentities[id] = true;
        }
        for (uint256 tokenId = 1; tokenId <= legacyTokenCount; tokenId++) {
            if (retiredLegacyIdentities[legacyIdentity.tokenToIdentity(tokenId)]) {
                retiredLegacyTokens[tokenId] = true;
                retiredLegacyTokenCount++;
            }
        }
        _tokenIdCounter = legacyTokenCount;
        migrationComplete = legacyAddress == address(0) || (legacyIdentityCount == 0 && legacyTokenCount == 0);
    }

    function setTimelineContract(address timelineAddress) external onlyOwner {
        require(timelineAddress != address(0), "Invalid timeline");
        timeline = IEyekonTimelineV4(timelineAddress);
    }

    function setPaymentSplitter(address splitterAddress) external onlyOwner {
        require(splitterAddress != address(0), "Invalid splitter");
        paymentSplitter = IEyekonPaymentSplitterV4(splitterAddress);
    }

    function createIdentity(
        string calldata name,
        uint256 organizationId,
        string calldata metadataURI,
        uint256 maxSupply,
        uint256 price,
        bool isMultiEdition,
        uint256 requiredPreviousId,
        uint8 holderDiscount,
        ClaimPolicy claimPolicy
    ) public ready returns (uint256 identityId) {
        require(bytes(name).length > 0, "Name cannot be empty");
        require(bytes(metadataURI).length > 0, "Metadata URI required");
        require(holderDiscount <= 100, "Discount cannot exceed 100%");
        if (organizationId != 0) {
            require(
                accessControl.isOrganizationAdminOrOwner(organizationId, msg.sender),
                "Not an organization owner or admin"
            );
        }

        bytes32 nameHash = _normalizedNameHash(name);
        require(!identityNameUsed[nameHash], "Identity name already exists");
        identityNameUsed[nameHash] = true;

        identityId = ++_identityIdCounter;
        identities[identityId] = Identity({
            id: identityId,
            organizationId: organizationId,
            creator: msg.sender,
            nameHash: nameHash,
            metadataURI: metadataURI,
            supply: 0,
            maxSupply: maxSupply,
            price: price,
            isMultiEdition: isMultiEdition,
            isActive: true,
            requiredPreviousId: requiredPreviousId,
            holderDiscount: holderDiscount,
            claimPolicy: claimPolicy,
            createdAt: block.timestamp
        });

        emit IdentityCreated(
            identityId, organizationId, msg.sender, nameHash, metadataURI,
            maxSupply, price, isMultiEdition, requiredPreviousId,
            holderDiscount, claimPolicy, block.timestamp
        );
    }

    function createEvolutionIdentity(
        string calldata name, uint256 organizationId, string calldata metadataURI,
        uint256 maxSupply, uint256 price, bool isMultiEdition, uint256 requiredPreviousId,
        uint8 holderDiscount, ClaimPolicy claimPolicy
    ) external ready returns (uint256 identityId) {
        require(requiredPreviousId == 0 || identities[requiredPreviousId].id != 0, "Previous identity missing");
        identityId = createIdentity(name, organizationId, metadataURI, maxSupply, price, isMultiEdition, requiredPreviousId, holderDiscount, claimPolicy);
        isEvolutionIdentity[identityId] = true;
    }

    function importLegacyIdentity(uint256 id) external onlyOwner {
        require(!migrationComplete && id == _identityIdCounter + 1 && id <= legacyIdentityCount, "Import sequential legacy IDs");
        IdentityNFTV3.Identity memory old = legacyIdentity.getIdentity(id);
        require(old.id == id && !identityNameUsed[old.nameHash], "Invalid legacy identity");
        if (retiredLegacyIdentities[id]) {
            identityNameUsed[old.nameHash] = true;
            legacyIdentitySnapshot[id] = keccak256(abi.encode(old));
            _identityIdCounter = id;
            emit LegacyTestIdentityRetired(id);
            return;
        }
        identities[id] = Identity(old.id,old.organizationId,old.creator,old.nameHash,old.metadataURI,0,old.maxSupply,old.price,old.isMultiEdition,old.isActive,old.requiredPreviousId,old.holderDiscount,ClaimPolicy(uint8(old.claimPolicy)),old.createdAt);
        identityNameUsed[old.nameHash] = true;
        identityToTimeline[id] = legacyIdentity.identityToTimeline(id);
        isEvolutionIdentity[id] = legacyIdentity.isEvolutionIdentity(id);
        legacyIdentitySnapshot[id] = keccak256(abi.encode(old));
        _identityIdCounter = id;
        emit LegacyIdentityImported(id);
    }

    // A holder transfers the original token directly. Its replacement is minted
    // atomically with the same ID; the original stays locked after finalization.
    function onERC721Received(address, address from, uint256 tokenId, bytes calldata) external nonReentrant returns (bytes4) {
        require(msg.sender == address(legacyIdentity) && !migrationComplete, "Legacy migration only");
        require(tokenId > 0 && tokenId <= legacyTokenCount && _ownerOf(tokenId) == address(0), "Invalid legacy token");
        require(!retiredLegacyTokens[tokenId], "Retired test edition");
        uint256 id = legacyIdentity.tokenToIdentity(tokenId);
        require(identities[id].id != 0 && legacyIdentitySnapshot[id] == keccak256(abi.encode(legacyIdentity.getIdentity(id))), "Import unchanged identity first");
        require(keccak256(bytes(legacyIdentity.tokenURI(tokenId))) == keccak256(bytes(identities[id].metadataURI)), "Legacy token metadata differs");
        tokenToIdentity[tokenId] = id;
        identities[id].supply++;
        userIdentityBalance[from][id]++;
        _addHolder(id,from);
        migratedTokenCount++;
        _safeMint(from,tokenId);
        _setTokenURI(tokenId,identities[id].metadataURI);
        emit LegacyTokenImported(tokenId,id,from);
        return IERC721Receiver.onERC721Received.selector;
    }

    function recoverLegacyToken(uint256 tokenId) external nonReentrant {
        require(!migrationComplete && ownerOf(tokenId) == msg.sender, "Only holder before finalization");
        uint256 id = tokenToIdentity[tokenId];
        userIdentityBalance[msg.sender][id]--;
        if(userIdentityBalance[msg.sender][id] == 0) _removeHolder(id,msg.sender);
        identities[id].supply--;
        migratedTokenCount--;
        _burn(tokenId);
        delete tokenToIdentity[tokenId];
        legacyIdentity.safeTransferFrom(address(this),msg.sender,tokenId);
        emit LegacyTokenRecovered(tokenId,msg.sender);
    }

    function finalizeMigration() external onlyOwner {
        require(!migrationComplete && _identityIdCounter == legacyIdentityCount && migratedTokenCount + retiredLegacyTokenCount == legacyTokenCount, "Migration incomplete");
        require(legacyIdentity.getTotalIdentities() == legacyIdentityCount && legacyIdentity.getTotalTokens() == legacyTokenCount, "Legacy counts changed");
        for(uint256 id=1; id<=legacyIdentityCount; id++) {
            IdentityNFTV3.Identity memory old = legacyIdentity.getIdentity(id);
            require(legacyIdentitySnapshot[id] == keccak256(abi.encode(old)), "Legacy identity changed");
            if (!retiredLegacyIdentities[id]) require(identities[id].supply == old.supply, "Legacy supply not fully imported");
        }
        for(uint256 tokenId=1; tokenId<=legacyTokenCount; tokenId++) {
            if (!retiredLegacyTokens[tokenId]) require(legacyIdentity.ownerOf(tokenId) == address(this) && _ownerOf(tokenId) != address(0), "Legacy token not escrowed");
        }
        migrationComplete = true;
    }

    function claimIdentity(
        uint256 identityId,
        address authorizedClaimant,
        bytes32 nonce,
        uint256 deadline,
        bytes calldata creatorSignature
    ) external payable ready nonReentrant returns (uint256 tokenId) {
        Identity storage identity = identities[identityId];
        require(identity.id != 0 && identity.isActive, "Identity unavailable");
        require(identity.maxSupply == 0 || identity.supply < identity.maxSupply, "Supply limit reached");
        if (identity.requiredPreviousId != 0) {
            require(userIdentityBalance[msg.sender][identity.requiredPreviousId] > 0, "Previous identity required");
        }

        if (identity.claimPolicy != ClaimPolicy.Public) {
            require(deadline >= block.timestamp, "Invitation expired");
            require(identity.claimPolicy != ClaimPolicy.Private || authorizedClaimant != address(0), "Private invitation must name a wallet");
            require(
                authorizedClaimant == address(0) || authorizedClaimant == msg.sender,
                "Invitation is for another wallet"
            );
            bytes32 digest = _hashTypedDataV4(
                keccak256(abi.encode(CLAIM_VOUCHER_TYPEHASH, identityId, authorizedClaimant, nonce, deadline))
            );
            require(!usedClaimVouchers[digest], "Invitation already used");
            require(isInvitationSigner(identityId, ECDSA.recover(digest, creatorSignature)), "Invalid invitation signature");
            usedClaimVouchers[digest] = true;
        } else {
            require(creatorSignature.length == 0, "Public claim needs no signature");
        }

        uint256 finalPrice = identity.price;
        if (
            identity.holderDiscount > 0 &&
            identity.requiredPreviousId > 0 &&
            userIdentityBalance[msg.sender][identity.requiredPreviousId] > 0
        ) {
            finalPrice = (identity.price * (100 - identity.holderDiscount)) / 100;
        }
        require(msg.value >= finalPrice, "Insufficient payment");

        tokenId = _mintIdentity(msg.sender, identityId);
        if (finalPrice > 0) {
            require(address(paymentSplitter) != address(0), "Payment splitter required");
            paymentSplitter.processPrimarySale{value: finalPrice}(identityId);
        }
        if (address(timeline) != address(0) && identityToTimeline[identityId] != 0) {
            timeline.completeChapterByIdentity(identityToTimeline[identityId], identityId, msg.sender);
        }
        if (msg.value > finalPrice) {
            (bool refunded, ) = payable(msg.sender).call{value: msg.value - finalPrice}("");
            require(refunded, "Refund failed");
        }
        emit IdentityClaimed(identityId, msg.sender, tokenId, finalPrice);
    }

    function mintIdentity(address to, uint256 identityId) external ready nonReentrant returns (uint256) {
        require(canManageIdentity(identityId, msg.sender), "Not authorized to mint");
        require(identities[identityId].requiredPreviousId == 0 || userIdentityBalance[to][identities[identityId].requiredPreviousId] > 0, "Previous identity required");
        uint256 tokenId = _mintIdentity(to, identityId);
        if (identityToTimeline[identityId] != 0) timeline.completeChapterByIdentity(identityToTimeline[identityId], identityId, to);
        return tokenId;
    }

    function _mintIdentity(address to, uint256 identityId) private returns (uint256 tokenId) {
        require(to != address(0), "Invalid recipient");
        Identity storage identity = identities[identityId];
        require(identity.id != 0 && identity.isActive, "Identity unavailable");
        require(identity.maxSupply == 0 || identity.supply < identity.maxSupply, "Supply limit reached");
        tokenId = ++_tokenIdCounter;
        identity.supply++;
        tokenToIdentity[tokenId] = identityId;
        userIdentityBalance[to][identityId]++;
        _addHolder(identityId, to);
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, identity.metadataURI);
        emit IdentityMinted(tokenId, identityId, to, identity.supply);
    }

    function linkIdentityToTimeline(uint256 identityId, uint256 timelineId) external ready {
        require(canManageIdentity(identityId, msg.sender), "Not authorized to link");
        require(timelineId != 0, "Invalid timeline");
        require(isEvolutionIdentity[identityId], "Create an evolution identity first");
        require(identityToTimeline[identityId] == 0, "Timeline link is immutable");
        require(address(timeline) != address(0) && timeline.identityToChapter(timelineId,identityId) > 0, "Register the chapter first");
        identityToTimeline[identityId] = timelineId;
        emit IdentityTimelineLinked(identityId, timelineId);
    }

    // Published definitions are immutable for both standard and evolution identities.
    function setPrice(uint256, uint256) external pure { revert("Published identity is immutable"); }
    function setSupplyLimit(uint256, uint256) external pure { revert("Published identity is immutable"); }
    function updateMetadataURI(uint256, string calldata) external pure { revert("Published identity is immutable"); }
    function setIdentityActive(uint256, bool) external pure { revert("Published identity is immutable"); }

    function getIdentity(uint256 identityId) external view returns (Identity memory) { return identities[identityId]; }
    function getIdentityCreator(uint256 identityId) external view returns (address) { return identities[identityId].creator; }
    function canManageIdentity(uint256 identityId, address account) public view returns (bool) {
        Identity memory identity = identities[identityId];
        if (identity.id == 0) return false;
        return identity.organizationId == 0 ? identity.creator == account :
            accessControl.isOrganizationAdminOrOwner(identity.organizationId, account);
    }
    function isInvitationSigner(uint256 identityId, address account) public view returns (bool) {
        return canManageIdentity(identityId, account);
    }
    function getHolders(uint256 identityId) external view returns (address[] memory) { return _identityHolders[identityId]; }
    function getHolderCount(uint256 identityId) external view returns (uint256) { return _identityHolders[identityId].length; }
    function balanceOfIdentity(address account, uint256 identityId) external view returns (uint256) { return userIdentityBalance[account][identityId]; }
    function getTotalIdentities() external view returns (uint256) { return _identityIdCounter; }
    function getTotalTokens() external view returns (uint256) { return _tokenIdCounter; }

    function canClaimChapter(address user, uint256 identityId) external view returns (bool) {
        Identity memory identity = identities[identityId];
        return identity.id != 0 && identity.isActive &&
            (identity.maxSupply == 0 || identity.supply < identity.maxSupply) &&
            (identity.requiredPreviousId == 0 || userIdentityBalance[user][identity.requiredPreviousId] > 0);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) require(migrationComplete, "Migration incomplete");
        if (from != address(0) && to != address(0) && from != to) {
            uint256 identityId = tokenToIdentity[tokenId];
            userIdentityBalance[from][identityId]--;
            if (userIdentityBalance[from][identityId] == 0) _removeHolder(identityId, from);
            userIdentityBalance[to][identityId]++;
            _addHolder(identityId, to);
        }
        return super._update(to, tokenId, auth);
    }

    function _addHolder(uint256 identityId, address holder) private {
        if (_holderIndexPlusOne[identityId][holder] == 0) {
            _identityHolders[identityId].push(holder);
            _holderIndexPlusOne[identityId][holder] = _identityHolders[identityId].length;
        }
    }

    function _removeHolder(uint256 identityId, address holder) private {
        uint256 indexPlusOne = _holderIndexPlusOne[identityId][holder];
        if (indexPlusOne == 0) return;
        uint256 index = indexPlusOne - 1;
        uint256 last = _identityHolders[identityId].length - 1;
        if (index != last) {
            address moved = _identityHolders[identityId][last];
            _identityHolders[identityId][index] = moved;
            _holderIndexPlusOne[identityId][moved] = index + 1;
        }
        _identityHolders[identityId].pop();
        delete _holderIndexPlusOne[identityId][holder];
    }

    function _normalizedNameHash(string calldata name) private pure returns (bytes32) {
        bytes calldata input = bytes(name);
        bytes memory normalized = new bytes(input.length);
        uint256 length;
        bool pendingSpace;
        for (uint256 i; i < input.length; i++) {
            bytes1 char = input[i];
            bool isSpace = char == 0x20 || char == 0x09 || char == 0x0a || char == 0x0d;
            if (isSpace) {
                if (length > 0) pendingSpace = true;
                continue;
            }
            if (pendingSpace) normalized[length++] = 0x20;
            pendingSpace = false;
            if (char >= 0x41 && char <= 0x5a) char = bytes1(uint8(char) + 32);
            normalized[length++] = char;
        }
        require(length > 0, "Name cannot be blank");
        assembly { mstore(normalized, length) }
        return keccak256(normalized);
    }

    receive() external payable {}
}

