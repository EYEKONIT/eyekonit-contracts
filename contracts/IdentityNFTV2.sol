// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./AccessControl.sol";

interface IEyekonTimelineV2 {
    function completeChapterByIdentity(uint256 timelineId, uint256 identityId, address user) external;
}

interface IEyekonPaymentSplitterV2 {
    function isRoyaltyConfigured(uint256 identityId) external view returns (bool);
    function processPrimarySale(uint256 identityId) external payable;
}

contract IdentityNFTV2 is ERC721URIStorage, Ownable, ReentrancyGuard, EIP712 {
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

    EyekonAccessControl public immutable accessControl;
    IEyekonTimelineV2 public timeline;
    IEyekonPaymentSplitterV2 public paymentSplitter;
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

    constructor(address accessControlAddress)
        ERC721("EYEKON Identity", "EYEKON")
        Ownable(msg.sender)
        EIP712("EYEKON Identity", "2")
    {
        require(accessControlAddress != address(0), "Invalid access control");
        accessControl = EyekonAccessControl(accessControlAddress);
    }

    function setTimelineContract(address timelineAddress) external onlyOwner {
        require(timelineAddress != address(0), "Invalid timeline");
        timeline = IEyekonTimelineV2(timelineAddress);
    }

    function setPaymentSplitter(address splitterAddress) external onlyOwner {
        require(splitterAddress != address(0), "Invalid splitter");
        paymentSplitter = IEyekonPaymentSplitterV2(splitterAddress);
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
    ) external returns (uint256 identityId) {
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

    function claimIdentity(
        uint256 identityId,
        address authorizedClaimant,
        bytes32 nonce,
        uint256 deadline,
        bytes calldata creatorSignature
    ) external payable nonReentrant returns (uint256 tokenId) {
        Identity storage identity = identities[identityId];
        require(identity.id != 0 && identity.isActive, "Identity unavailable");
        require(identity.claimPolicy != ClaimPolicy.Private, "Identity is private");
        require(identity.maxSupply == 0 || identity.supply < identity.maxSupply, "Supply limit reached");
        if (identity.requiredPreviousId != 0) {
            require(userIdentityBalance[msg.sender][identity.requiredPreviousId] > 0, "Previous identity required");
        }

        if (identity.claimPolicy == ClaimPolicy.InviteOnly) {
            require(deadline >= block.timestamp, "Invitation expired");
            require(
                authorizedClaimant == address(0) || authorizedClaimant == msg.sender,
                "Invitation is for another wallet"
            );
            bytes32 digest = _hashTypedDataV4(
                keccak256(abi.encode(CLAIM_VOUCHER_TYPEHASH, identityId, authorizedClaimant, nonce, deadline))
            );
            require(!usedClaimVouchers[digest], "Invitation already used");
            require(ECDSA.recover(digest, creatorSignature) == identity.creator, "Invalid invitation signature");
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
            if (address(paymentSplitter) != address(0) && paymentSplitter.isRoyaltyConfigured(identityId)) {
                paymentSplitter.processPrimarySale{value: finalPrice}(identityId);
            } else {
                (bool paid, ) = payable(identity.creator).call{value: finalPrice}("");
                require(paid, "Creator payment failed");
            }
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

    function mintIdentity(address to, uint256 identityId) external nonReentrant returns (uint256) {
        require(canManageIdentity(identityId, msg.sender), "Not authorized to mint");
        return _mintIdentity(to, identityId);
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

    function linkIdentityToTimeline(uint256 identityId, uint256 timelineId) external {
        require(canManageIdentity(identityId, msg.sender), "Not authorized to link");
        require(timelineId != 0, "Invalid timeline");
        identityToTimeline[identityId] = timelineId;
        emit IdentityTimelineLinked(identityId, timelineId);
    }

    function setPrice(uint256 identityId, uint256 newPrice) external {
        require(canManageIdentity(identityId, msg.sender), "Not authorized to update price");
        identities[identityId].price = newPrice;
        emit PriceUpdated(identityId, newPrice);
    }

    function setSupplyLimit(uint256 identityId, uint256 limit) external {
        Identity storage identity = identities[identityId];
        require(canManageIdentity(identityId, msg.sender), "Not authorized to update supply");
        require(limit == 0 || limit >= identity.supply, "Limit below current supply");
        identity.maxSupply = limit;
        emit SupplyLimitSet(identityId, limit);
    }

    function updateMetadataURI(uint256 identityId, string calldata newURI) external {
        require(canManageIdentity(identityId, msg.sender), "Not authorized to update metadata");
        require(bytes(newURI).length > 0, "Metadata URI required");
        identities[identityId].metadataURI = newURI;
        emit MetadataURIUpdated(identityId, newURI);
    }

    function setIdentityActive(uint256 identityId, bool active) external {
        require(canManageIdentity(identityId, msg.sender), "Not authorized to change status");
        identities[identityId].isActive = active;
        emit IdentityActiveStatusChanged(identityId, active);
    }

    function getIdentity(uint256 identityId) external view returns (Identity memory) { return identities[identityId]; }
    function getIdentityCreator(uint256 identityId) external view returns (address) { return identities[identityId].creator; }
    function canManageIdentity(uint256 identityId, address account) public view returns (bool) {
        Identity memory identity = identities[identityId];
        return identity.creator == account ||
            (identity.organizationId != 0 && accessControl.isOrganizationAdminOrOwner(identity.organizationId, account));
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
