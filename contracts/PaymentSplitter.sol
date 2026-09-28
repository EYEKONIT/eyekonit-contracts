// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EYEKON PaymentSplitter
 * @dev Manages revenue distribution for identity sales and royalties
 */
contract PaymentSplitter is Ownable, ReentrancyGuard {
    struct Split {
        address payable recipient;
        uint16 percentage; // Basis points (100 = 1%, 10000 = 100%)
    }

    struct RoyaltyConfig {
        uint256 identityId;
        uint16 royaltyPercentage; // Basis points for secondary sales
        Split[] splits;
        bool isActive;
    }

    // State variables
    mapping(uint256 => RoyaltyConfig) public identityRoyalties; // identityId => RoyaltyConfig
    mapping(uint256 => mapping(address => uint256)) public pendingWithdrawals; // identityId => recipient => amount
    mapping(address => uint256) public totalEarnings; // recipient => total earned
    
    uint16 public constant MAX_ROYALTY_PERCENTAGE = 1000; // 10% max royalty
    uint16 public constant BASIS_POINTS = 10000; // 100%

    /**
     * @dev Constructor
     */
    constructor() Ownable(msg.sender) {}

    // Events
    event RoyaltyConfigured(
        uint256 indexed identityId,
        uint16 royaltyPercentage,
        uint256 splitCount
    );

    event PaymentReceived(
        uint256 indexed identityId,
        address indexed payer,
        uint256 amount,
        bool isPrimarySale
    );

    event PaymentSplit(
        uint256 indexed identityId,
        address indexed recipient,
        uint256 amount
    );

    event Withdrawal(
        address indexed recipient,
        uint256 amount
    );

    event RoyaltyUpdated(
        uint256 indexed identityId,
        uint16 newRoyaltyPercentage
    );

    /**
     * @dev Configure royalty and payment splits for an identity
     */
    function configureRoyalty(
        uint256 identityId,
        uint16 royaltyPercentage,
        address[] memory recipients,
        uint16[] memory percentages
    ) external onlyOwner {
        require(royaltyPercentage <= MAX_ROYALTY_PERCENTAGE, "Royalty too high");
        require(recipients.length == percentages.length, "Array length mismatch");
        require(recipients.length > 0, "Must have at least one recipient");

        // Validate percentages sum to 100%
        uint16 totalPercentage = 0;
        for (uint256 i = 0; i < percentages.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient address");
            require(percentages[i] > 0, "Percentage must be greater than 0");
            totalPercentage += percentages[i];
        }
        require(totalPercentage == BASIS_POINTS, "Percentages must sum to 100%");

        // Clear existing splits
        delete identityRoyalties[identityId];

        // Create new royalty config
        RoyaltyConfig storage config = identityRoyalties[identityId];
        config.identityId = identityId;
        config.royaltyPercentage = royaltyPercentage;
        config.isActive = true;

        // Add splits
        for (uint256 i = 0; i < recipients.length; i++) {
            config.splits.push(Split({
                recipient: payable(recipients[i]),
                percentage: percentages[i]
            }));
        }

        emit RoyaltyConfigured(identityId, royaltyPercentage, recipients.length);
    }

    /**
     * @dev Process primary sale payment
     */
    function processPrimarySale(uint256 identityId) 
        external 
        payable 
        nonReentrant 
    {
        require(msg.value > 0, "Payment required");
        require(identityRoyalties[identityId].isActive, "Royalty not configured");

        _splitPayment(identityId, msg.value, true);
    }

    /**
     * @dev Process secondary sale royalty
     */
    function processSecondarySale(uint256 identityId, uint256 salePrice) 
        external 
        payable 
        nonReentrant 
    {
        require(identityRoyalties[identityId].isActive, "Royalty not configured");
        
        RoyaltyConfig storage config = identityRoyalties[identityId];
        uint256 royaltyAmount = (salePrice * config.royaltyPercentage) / BASIS_POINTS;
        
        require(msg.value >= royaltyAmount, "Insufficient royalty payment");

        _splitPayment(identityId, royaltyAmount, false);

        // Refund excess
        if (msg.value > royaltyAmount) {
            payable(msg.sender).transfer(msg.value - royaltyAmount);
        }
    }

    /**
     * @dev Internal function to split payment among recipients
     */
    function _splitPayment(
        uint256 identityId,
        uint256 amount,
        bool isPrimarySale
    ) private {
        RoyaltyConfig storage config = identityRoyalties[identityId];
        
        for (uint256 i = 0; i < config.splits.length; i++) {
            Split memory split = config.splits[i];
            uint256 splitAmount = (amount * split.percentage) / BASIS_POINTS;
            
            pendingWithdrawals[identityId][split.recipient] += splitAmount;
            totalEarnings[split.recipient] += splitAmount;
            
            emit PaymentSplit(identityId, split.recipient, splitAmount);
        }

        emit PaymentReceived(identityId, msg.sender, amount, isPrimarySale);
    }

    /**
     * @dev Withdraw pending payments
     */
    function withdraw(uint256 identityId) external nonReentrant {
        uint256 amount = pendingWithdrawals[identityId][msg.sender];
        require(amount > 0, "No pending withdrawals");

        pendingWithdrawals[identityId][msg.sender] = 0;
        payable(msg.sender).transfer(amount);

        emit Withdrawal(msg.sender, amount);
    }

    /**
     * @dev Withdraw all pending payments across all identities
     */
    function withdrawAll(uint256[] calldata identityIds) external nonReentrant {
        uint256 totalAmount = 0;

        for (uint256 i = 0; i < identityIds.length; i++) {
            uint256 amount = pendingWithdrawals[identityIds[i]][msg.sender];
            if (amount > 0) {
                pendingWithdrawals[identityIds[i]][msg.sender] = 0;
                totalAmount += amount;
            }
        }

        require(totalAmount > 0, "No pending withdrawals");
        payable(msg.sender).transfer(totalAmount);

        emit Withdrawal(msg.sender, totalAmount);
    }

    /**
     * @dev Update royalty percentage
     */
    function updateRoyaltyPercentage(uint256 identityId, uint16 newPercentage) 
        external 
        onlyOwner 
    {
        require(identityRoyalties[identityId].isActive, "Royalty not configured");
        require(newPercentage <= MAX_ROYALTY_PERCENTAGE, "Royalty too high");

        identityRoyalties[identityId].royaltyPercentage = newPercentage;

        emit RoyaltyUpdated(identityId, newPercentage);
    }

    /**
     * @dev Get royalty info for an identity
     */
    function getRoyaltyInfo(uint256 identityId, uint256 salePrice) 
        external 
        view 
        returns (address[] memory recipients, uint256[] memory amounts) 
    {
        require(identityRoyalties[identityId].isActive, "Royalty not configured");
        
        RoyaltyConfig storage config = identityRoyalties[identityId];
        uint256 royaltyAmount = (salePrice * config.royaltyPercentage) / BASIS_POINTS;
        
        recipients = new address[](config.splits.length);
        amounts = new uint256[](config.splits.length);
        
        for (uint256 i = 0; i < config.splits.length; i++) {
            recipients[i] = config.splits[i].recipient;
            amounts[i] = (royaltyAmount * config.splits[i].percentage) / BASIS_POINTS;
        }
        
        return (recipients, amounts);
    }

    /**
     * @dev Get pending withdrawal amount for a recipient
     */
    function getPendingWithdrawal(uint256 identityId, address recipient) 
        external 
        view 
        returns (uint256) 
    {
        return pendingWithdrawals[identityId][recipient];
    }

    /**
     * @dev Get total pending withdrawals for a recipient across all identities
     */
    function getTotalPendingWithdrawals(address recipient, uint256[] calldata identityIds) 
        external 
        view 
        returns (uint256) 
    {
        uint256 total = 0;
        for (uint256 i = 0; i < identityIds.length; i++) {
            total += pendingWithdrawals[identityIds[i]][recipient];
        }
        return total;
    }

    /**
     * @dev Get split configuration for an identity
     */
    function getSplits(uint256 identityId) 
        external 
        view 
        returns (address[] memory recipients, uint16[] memory percentages) 
    {
        require(identityRoyalties[identityId].isActive, "Royalty not configured");
        
        RoyaltyConfig storage config = identityRoyalties[identityId];
        recipients = new address[](config.splits.length);
        percentages = new uint16[](config.splits.length);
        
        for (uint256 i = 0; i < config.splits.length; i++) {
            recipients[i] = config.splits[i].recipient;
            percentages[i] = config.splits[i].percentage;
        }
        
        return (recipients, percentages);
    }

    /**
     * @dev Check if royalty is configured for an identity
     */
    function isRoyaltyConfigured(uint256 identityId) external view returns (bool) {
        return identityRoyalties[identityId].isActive;
    }

    /**
     * @dev Get royalty percentage for an identity
     */
    function getRoyaltyPercentage(uint256 identityId) external view returns (uint16) {
        require(identityRoyalties[identityId].isActive, "Royalty not configured");
        return identityRoyalties[identityId].royaltyPercentage;
    }
}
