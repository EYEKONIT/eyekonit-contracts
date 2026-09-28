// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AccessControl.sol";
import "./Timeline.sol";
import "./PaymentSplitter.sol";

/**
 * @title EYEKON IdentityNFT
 * @dev Manages identity NFTs with support for both ERC-721 (single edition) and ERC-1155 (multi-edition)
 * Supports supply limits, pricing, evolution/timeline requirements, and holder discounts
 */
contract IdentityNFT is ERC721URIStorage, Ownable, ReentrancyGuard {
    // Identity structure
    struct Identity {
        uint256 id;
        address creator;
        string metadataURI;
        uint256 supply;
        uint256 maxSupply;
        uint256 price;
        bool isMultiEdition;
        bool isActive;
        uint256 requiredPreviousId; // For evolution identities (0 if not required)
        uint8 holderDiscount; // Discount percentage for timeline holders (0-100) - optimized to uint8
        uint256 createdAt;
    }

    // State variables
    EyekonAccessControl public immutable accessControl; // Made immutable for gas savings
    Timeline public timeline; // Timeline contract
    PaymentSplitter public paymentSplitter; // Payment splitter contract
    uint256 private _identityIdCounter;
    uint256 private _tokenIdCounter;
    
    mapping(uint256 => Identity) public identities;
    mapping(uint256 => uint256) public tokenToIdentity; // tokenId => identityId
    mapping(uint256 => uint256) public identityToTimeline; // identityId => timelineId
    mapping(uint256 => address[]) public identityHolders;
    mapping(address => mapping(uint256 => uint256)) public userIdentityBalance;
    mapping(bytes32 => bool) public usedInvitations; // invitation hash => used

    // Events
    event IdentityCreated(
        uint256 indexed identityId,
        address indexed creator,
        string metadataURI,
        uint256 maxSupply,
        uint256 price,
        bool isMultiEdition,
        uint256 requiredPreviousId,
        uint8 holderDiscount,
        uint256 createdAt
    );
    event IdentityMinted(
        uint256 indexed tokenId,
        uint256 indexed identityId,
        address indexed owner,
        uint256 editionNumber
    );
    event IdentityClaimed(
        uint256 indexed identityId,
        address indexed claimer,
        uint256 tokenId,
        uint256 pricePaid
    );
    event PriceUpdated(uint256 indexed identityId, uint256 newPrice);
    event SupplyLimitSet(uint256 indexed identityId, uint256 limit);
    event IdentityActiveStatusChanged(uint256 indexed identityId, bool isActive);

    /**
     * @dev Constructor
     * @param _accessControl Address of the AccessControl contract
     */
    constructor(address _accessControl) 
        ERC721("EYEKON Identity", "EYEKON") 
        Ownable(msg.sender)
    {
        accessControl = EyekonAccessControl(_accessControl);
    }

    /**
     * @dev Set Timeline contract address
     */
    function setTimelineContract(address _timeline) external onlyOwner {
        require(_timeline != address(0), "Invalid timeline address");
        timeline = Timeline(_timeline);
    }

    /**
     * @dev Set PaymentSplitter contract address
     */
    function setPaymentSplitter(address _paymentSplitter) external onlyOwner {
        require(_paymentSplitter != address(0), "Invalid payment splitter address");
        paymentSplitter = PaymentSplitter(_paymentSplitter);
    }

    /**
     * @dev Link identity to timeline
     */
    function linkIdentityToTimeline(uint256 identityId, uint256 timelineId) external {
        require(
            accessControl.canMintIdentity(msg.sender),
            "Not authorized"
        );
        require(identities[identityId].id != 0, "Identity does not exist");
        identityToTimeline[identityId] = timelineId;
    }

    /**
     * @dev Create a new identity
     * @param metadataURI IPFS URI for identity metadata
     * @param maxSupply Maximum number of editions (0 for unlimited)
     * @param price Price in wei (0 for free)
     * @param isMultiEdition Whether this is a multi-edition identity
     * @param requiredPreviousId Required previous identity ID for evolution (0 if none)
     * @param holderDiscount Discount percentage for timeline holders (0-100)
     * @return identityId The ID of the created identity
     */
    function createIdentity(
        string calldata metadataURI, // Changed to calldata for gas savings
        uint256 maxSupply,
        uint256 price,
        bool isMultiEdition,
        uint256 requiredPreviousId,
        uint8 holderDiscount // Changed to uint8
    ) external returns (uint256) {
        require(
            accessControl.canMintIdentity(msg.sender),
            "Not authorized to create identities"
        );
        require(holderDiscount <= 100, "Discount cannot exceed 100%");
        
        unchecked {
            _identityIdCounter++;
        }
        uint256 identityId = _identityIdCounter;

        identities[identityId] = Identity({
            id: identityId,
            creator: msg.sender,
            metadataURI: metadataURI,
            supply: 0,
            maxSupply: maxSupply,
            price: price,
            isMultiEdition: isMultiEdition,
            isActive: true,
            requiredPreviousId: requiredPreviousId,
            holderDiscount: holderDiscount,
            createdAt: block.timestamp
        });

        emit IdentityCreated(
            identityId,
            msg.sender,
            metadataURI,
            maxSupply,
            price,
            isMultiEdition,
            requiredPreviousId,
            holderDiscount,
            block.timestamp
        );
        return identityId;
    }

    /**
     * @dev Mint an identity NFT to a specific address (for free claims or admin minting)
     * @param to Address to mint to
     * @param identityId Identity ID to mint
     * @return tokenId The minted token ID
     */
    function mintIdentity(address to, uint256 identityId) 
        external 
        nonReentrant 
        returns (uint256) 
    {
        require(
            accessControl.canMintIdentity(msg.sender),
            "Not authorized to mint"
        );
        
        Identity storage identity = identities[identityId];
        require(identity.isActive, "Identity does not exist or is inactive");
        require(
            identity.maxSupply == 0 || identity.supply < identity.maxSupply,
            "Supply limit reached"
        );

        unchecked {
            _tokenIdCounter++;
        }
        uint256 tokenId = _tokenIdCounter;
        
        unchecked {
            identity.supply++;
        }
        tokenToIdentity[tokenId] = identityId;
        
        // Track holder
        if (userIdentityBalance[to][identityId] == 0) {
            identityHolders[identityId].push(to);
        }
        unchecked {
            userIdentityBalance[to][identityId]++;
        }

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, identity.metadataURI);

        emit IdentityMinted(tokenId, identityId, to, identity.supply);
        return tokenId;
    }

    /**
     * @dev Claim/purchase an identity NFT
     * @param identityId Identity ID to claim
     * @param invitationHash Optional invitation hash for invite-only identities
     * @return tokenId The minted token ID
     */
    function claimIdentity(uint256 identityId, bytes32 invitationHash) 
        external 
        payable 
        nonReentrant 
        returns (uint256) 
    {
        Identity storage identity = identities[identityId];
        require(identity.isActive, "Identity does not exist or is inactive");
        require(
            identity.maxSupply == 0 || identity.supply < identity.maxSupply,
            "Supply limit reached"
        );

        // Check evolution requirements
        if (identity.requiredPreviousId > 0) {
            require(
                userIdentityBalance[msg.sender][identity.requiredPreviousId] > 0,
                "Must own previous chapter to claim this evolution"
            );
        }

        // Calculate price with potential holder discount
        uint256 finalPrice = identity.price;
        if (identity.holderDiscount > 0 && identity.requiredPreviousId > 0) {
            if (userIdentityBalance[msg.sender][identity.requiredPreviousId] > 0) {
                finalPrice = (identity.price * (100 - identity.holderDiscount)) / 100;
            }
        }

        // Check payment
        require(msg.value >= finalPrice, "Insufficient payment");

        // Validate invitation if provided
        if (invitationHash != bytes32(0)) {
            require(!usedInvitations[invitationHash], "Invitation already used");
            usedInvitations[invitationHash] = true;
        }

        _tokenIdCounter++;
        uint256 tokenId = _tokenIdCounter;
        
        identity.supply++;
        tokenToIdentity[tokenId] = identityId;
        
        // Track holder
        if (userIdentityBalance[msg.sender][identityId] == 0) {
            identityHolders[identityId].push(msg.sender);
        }
        userIdentityBalance[msg.sender][identityId]++;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, identity.metadataURI);

        // Process payment through PaymentSplitter if configured
        if (finalPrice > 0) {
            if (address(paymentSplitter) != address(0) && paymentSplitter.isRoyaltyConfigured(identityId)) {
                // Send payment to PaymentSplitter for distribution
                paymentSplitter.processPrimarySale{value: finalPrice}(identityId);
            } else {
                // Fallback: Transfer payment directly to creator
                (bool success, ) = payable(identity.creator).call{value: finalPrice}("");
                require(success, "Payment transfer failed");
            }
        }

        // Record timeline progress if identity is part of a timeline
        if (address(timeline) != address(0) && identityToTimeline[identityId] != 0) {
            uint256 timelineId = identityToTimeline[identityId];
            // Get chapter number from timeline
            try timeline.completeChapter(timelineId, identityId, msg.sender) {
                // Chapter completion recorded
            } catch {
                // Continue even if timeline recording fails
            }
        }

        // Refund excess payment
        if (msg.value > finalPrice) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - finalPrice}("");
            require(refundSuccess, "Refund failed");
        }

        emit IdentityClaimed(identityId, msg.sender, tokenId, finalPrice);
        emit IdentityMinted(tokenId, identityId, msg.sender, identity.supply);
        
        return tokenId;
    }

    /**
     * @dev Update identity price
     * @param identityId Identity ID
     * @param newPrice New price in wei
     */
    function setPrice(uint256 identityId, uint256 newPrice) external {
        Identity storage identity = identities[identityId];
        require(identity.creator == msg.sender, "Only creator can update price");
        
        identity.price = newPrice;
        emit PriceUpdated(identityId, newPrice);
    }

    /**
     * @dev Update supply limit
     * @param identityId Identity ID
     * @param limit New supply limit
     */
    function setSupplyLimit(uint256 identityId, uint256 limit) external {
        Identity storage identity = identities[identityId];
        require(identity.creator == msg.sender, "Only creator can update supply");
        require(limit >= identity.supply, "Cannot set limit below current supply");
        
        identity.maxSupply = limit;
        emit SupplyLimitSet(identityId, limit);
    }

    /**
     * @dev Update metadata URI
     * @param identityId Identity ID
     * @param newURI New metadata URI
     */
    function updateMetadataURI(uint256 identityId, string memory newURI) external {
        Identity storage identity = identities[identityId];
        require(identity.creator == msg.sender, "Only creator can update metadata");
        
        identity.metadataURI = newURI;
        
        // Update all existing tokens with this identity
        // Note: This is gas-intensive for large supplies
        // Consider emitting an event instead and updating off-chain
    }

    /**
     * @dev Pause/unpause an identity
     * @param identityId Identity ID
     * @param active New active status
     */
    function setIdentityActive(uint256 identityId, bool active) external {
        Identity storage identity = identities[identityId];
        require(
            identity.creator == msg.sender || accessControl.hasRole(accessControl.ADMIN_ROLE(), msg.sender),
            "Not authorized"
        );
        
        identity.isActive = active;
        emit IdentityActiveStatusChanged(identityId, active);
    }

    /**
     * @dev Get remaining supply for an identity
     * @param identityId Identity ID
     * @return Remaining supply (0 if unlimited)
     */
    function getRemainingSupply(uint256 identityId) external view returns (uint256) {
        Identity memory identity = identities[identityId];
        if (identity.maxSupply == 0) {
            return type(uint256).max; // Unlimited
        }
        return identity.maxSupply - identity.supply;
    }

    /**
     * @dev Get identity details
     * @param identityId Identity ID
     * @return Identity struct
     */
    function getIdentity(uint256 identityId) external view returns (Identity memory) {
        return identities[identityId];
    }

    /**
     * @dev Get all holders of an identity
     * @param identityId Identity ID
     * @return Array of holder addresses
     */
    function getHolders(uint256 identityId) external view returns (address[] memory) {
        return identityHolders[identityId];
    }

    /**
     * @dev Get holder count for an identity
     * @param identityId Identity ID
     * @return Number of unique holders
     */
    function getHolderCount(uint256 identityId) external view returns (uint256) {
        return identityHolders[identityId].length;
    }

    /**
     * @dev Get user's balance of a specific identity
     * @param owner Owner address
     * @param identityId Identity ID
     * @return Balance
     */
    function balanceOfIdentity(address owner, uint256 identityId) 
        external 
        view 
        returns (uint256) 
    {
        return userIdentityBalance[owner][identityId];
    }

    /**
     * @dev Check if user can claim a specific evolution chapter
     * @param user User address
     * @param chapterId Chapter identity ID
     * @return bool True if user can claim
     */
    function canClaimChapter(address user, uint256 chapterId) 
        external 
        view 
        returns (bool) 
    {
        Identity memory chapter = identities[chapterId];
        if (!chapter.isActive) return false;
        if (chapter.maxSupply > 0 && chapter.supply >= chapter.maxSupply) return false;
        if (chapter.requiredPreviousId > 0) {
            return userIdentityBalance[user][chapter.requiredPreviousId] > 0;
        }
        return true;
    }

    /**
     * @dev Get total number of identities created
     * @return Total identities count
     */
    function getTotalIdentities() external view returns (uint256) {
        return _identityIdCounter;
    }

    /**
     * @dev Get total number of tokens minted
     * @return Total tokens count
     */
    function getTotalTokens() external view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev Override transfer to update holder tracking
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        
        if (from != address(0) && to != address(0)) {
            uint256 identityId = tokenToIdentity[tokenId];
            
            // Update balances
            userIdentityBalance[from][identityId]--;
            userIdentityBalance[to][identityId]++;
            
            // Add new holder if needed
            if (userIdentityBalance[to][identityId] == 1) {
                identityHolders[identityId].push(to);
            }
        }
        
        return super._update(to, tokenId, auth);
    }

    /**
     * @dev Withdraw contract balance (only owner)
     */
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance to withdraw");
        
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdrawal failed");
    }

    /**
     * @dev Receive function to accept ETH
     */
    receive() external payable {}
}
