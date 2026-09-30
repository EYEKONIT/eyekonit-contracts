// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IIdentityOwnershipV2 {
    function getIdentityCreator(uint256 identityId) external view returns (address);
    function canManageIdentity(uint256 identityId, address account) external view returns (bool);
    function paymentSplitter() external view returns (address);
}

interface ILegacyPaymentSplitterV2 {
    function isRoyaltyConfigured(uint256 identityId) external view returns (bool);
    function isSecondaryRoyaltyConfigured(uint256 identityId) external view returns (bool);
    function getRoyaltyPercentage(uint256 identityId) external view returns (uint16);
    function getSplits(uint256 identityId) external view returns (address[] memory, uint16[] memory);
}

contract PaymentSplitterV2 is ReentrancyGuard {
    struct Split { address payable recipient; uint16 percentage; }
    struct RoyaltyConfig { uint16 royaltyPercentage; Split[] splits; bool isActive; }

    uint16 public constant MAX_ROYALTY_PERCENTAGE = 1000;
    uint16 public constant BASIS_POINTS = 10000;
    uint16 public constant PLATFORM_FEE_BPS = 2000;
    address payable public constant PLATFORM_WALLET = payable(0x497574eE15579f9F6836D472EAC236F85Be4478D);
    IIdentityOwnershipV2 public immutable identityContract;
    ILegacyPaymentSplitterV2 public immutable legacySplitter;
    mapping(uint256 => RoyaltyConfig) private _royalties;
    mapping(uint256 => mapping(address => uint256)) public pendingWithdrawals;
    mapping(address => uint256) public totalEarnings;

    event RoyaltyConfigured(uint256 indexed identityId, uint16 royaltyPercentage, uint256 splitCount);
    event RoyaltyUpdated(uint256 indexed identityId, uint16 newRoyaltyPercentage);
    event PaymentReceived(uint256 indexed identityId, address indexed payer, uint256 amount, bool isPrimarySale);
    event PaymentSplit(uint256 indexed identityId, address indexed recipient, uint256 amount);
    event Withdrawal(address indexed recipient, uint256 amount);
    event PrimarySaleSettled(uint256 indexed identityId, address indexed owner, address indexed platform, uint256 grossAmount, uint256 ownerAmount, uint256 platformAmount);

    constructor(address identityAddress) {
        require(identityAddress != address(0), "Invalid identity contract");
        identityContract = IIdentityOwnershipV2(identityAddress);
        // Preserve optional secondary royalty configurations during an in-place
        // splitter replacement. Old pending funds stay withdrawable at the old address.
        legacySplitter = ILegacyPaymentSplitterV2(identityContract.paymentSplitter());
    }

    modifier onlyIdentityCreator(uint256 identityId) {
        require(identityContract.canManageIdentity(identityId, msg.sender), "Not authorized for identity");
        _;
    }

    function configureRoyalty(
        uint256 identityId,
        uint16 royaltyPercentage,
        address[] calldata recipients,
        uint16[] calldata percentages
    ) external onlyIdentityCreator(identityId) {
        require(royaltyPercentage <= MAX_ROYALTY_PERCENTAGE, "Royalty too high");
        require(recipients.length > 0 && recipients.length == percentages.length, "Invalid splits");
        uint256 total;
        for (uint256 i; i < recipients.length; i++) {
            require(recipients[i] != address(0) && percentages[i] > 0, "Invalid split");
            total += percentages[i];
        }
        require(total == BASIS_POINTS, "Percentages must total 100%");
        delete _royalties[identityId];
        RoyaltyConfig storage config = _royalties[identityId];
        config.royaltyPercentage = royaltyPercentage;
        config.isActive = true;
        for (uint256 i; i < recipients.length; i++) {
            config.splits.push(Split(payable(recipients[i]), percentages[i]));
        }
        emit RoyaltyConfigured(identityId, royaltyPercentage, recipients.length);
    }

    function updateRoyaltyPercentage(uint256 identityId, uint16 percentage) external onlyIdentityCreator(identityId) {
        _loadLegacyRoyalty(identityId);
        require(_royalties[identityId].isActive, "Royalty not configured");
        require(percentage <= MAX_ROYALTY_PERCENTAGE, "Royalty too high");
        _royalties[identityId].royaltyPercentage = percentage;
        emit RoyaltyUpdated(identityId, percentage);
    }

    function processPrimarySale(uint256 identityId) external payable nonReentrant {
        require(msg.sender == address(identityContract), "Only identity contract");
        address payable creator = payable(identityContract.getIdentityCreator(identityId));
        require(msg.value > 0 && creator != address(0), "Invalid primary sale");
        uint256 platformAmount = (msg.value * PLATFORM_FEE_BPS) / BASIS_POINTS;
        uint256 ownerAmount = msg.value - platformAmount;
        // Primary sales are independent of optional secondary royalty recipients.
        // Any failed payout reverts the entire claim, including the NFT mint.
        totalEarnings[creator] += ownerAmount;
        totalEarnings[PLATFORM_WALLET] += platformAmount;
        (bool ownerPaid, ) = creator.call{value: ownerAmount}("");
        require(ownerPaid, "Owner payment failed");
        if (platformAmount > 0) {
            (bool platformPaid, ) = PLATFORM_WALLET.call{value: platformAmount}("");
            require(platformPaid, "Platform payment failed");
        }
        emit PaymentSplit(identityId, creator, ownerAmount);
        emit PaymentSplit(identityId, PLATFORM_WALLET, platformAmount);
        emit PrimarySaleSettled(identityId, creator, PLATFORM_WALLET, msg.value, ownerAmount, platformAmount);
        emit PaymentReceived(identityId, msg.sender, msg.value, true);
    }

    function processSecondarySale(uint256 identityId, uint256 salePrice) external payable nonReentrant {
        _loadLegacyRoyalty(identityId);
        RoyaltyConfig storage config = _royalties[identityId];
        require(config.isActive, "Royalty not configured");
        uint256 royalty = (salePrice * config.royaltyPercentage) / BASIS_POINTS;
        require(msg.value >= royalty, "Insufficient royalty payment");
        _split(identityId, royalty, false);
        if (msg.value > royalty) {
            (bool refunded, ) = payable(msg.sender).call{value: msg.value - royalty}("");
            require(refunded, "Refund failed");
        }
    }

    function _split(uint256 identityId, uint256 amount, bool primary) private {
        Split[] storage splits = _royalties[identityId].splits;
        uint256 distributed;
        for (uint256 i; i < splits.length; i++) {
            uint256 share = i == splits.length - 1
                ? amount - distributed
                : (amount * splits[i].percentage) / BASIS_POINTS;
            distributed += share;
            pendingWithdrawals[identityId][splits[i].recipient] += share;
            totalEarnings[splits[i].recipient] += share;
            emit PaymentSplit(identityId, splits[i].recipient, share);
        }
        emit PaymentReceived(identityId, msg.sender, amount, primary);
    }

    function withdraw(uint256 identityId) external nonReentrant {
        uint256 amount = pendingWithdrawals[identityId][msg.sender];
        require(amount > 0, "No pending withdrawals");
        pendingWithdrawals[identityId][msg.sender] = 0;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Withdrawal failed");
        emit Withdrawal(msg.sender, amount);
    }

    function withdrawAll(uint256[] calldata identityIds) external nonReentrant {
        uint256 amount;
        for (uint256 i; i < identityIds.length; i++) {
            amount += pendingWithdrawals[identityIds[i]][msg.sender];
            pendingWithdrawals[identityIds[i]][msg.sender] = 0;
        }
        require(amount > 0, "No pending withdrawals");
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Withdrawal failed");
        emit Withdrawal(msg.sender, amount);
    }

    // Legacy IdentityNFTV2 uses this gate before calling processPrimarySale.
    // Returning true for every existing identity activates the mandatory split
    // when this splitter is attached to an already deployed identity contract.
    function isRoyaltyConfigured(uint256 identityId) external view returns (bool) { return identityContract.getIdentityCreator(identityId) != address(0); }
    function isSecondaryRoyaltyConfigured(uint256 identityId) external view returns (bool) { return _royalties[identityId].isActive || _legacyConfigured(identityId); }
    function getRoyaltyPercentage(uint256 identityId) public view returns (uint16) {
        if (_royalties[identityId].isActive) return _royalties[identityId].royaltyPercentage;
        return _legacyConfigured(identityId) ? legacySplitter.getRoyaltyPercentage(identityId) : 0;
    }
    function getPendingWithdrawal(uint256 identityId, address recipient) external view returns (uint256) { return pendingWithdrawals[identityId][recipient]; }
    function getSplits(uint256 identityId) public view returns (address[] memory recipients, uint16[] memory percentages) {
        if (!_royalties[identityId].isActive && _legacyConfigured(identityId)) return legacySplitter.getSplits(identityId);
        Split[] storage splits = _royalties[identityId].splits;
        recipients = new address[](splits.length);
        percentages = new uint16[](splits.length);
        for (uint256 i; i < splits.length; i++) {
            recipients[i] = splits[i].recipient;
            percentages[i] = splits[i].percentage;
        }
    }

    function getTotalPendingWithdrawals(address recipient, uint256[] calldata identityIds) external view returns (uint256 total) {
        for (uint256 i; i < identityIds.length; i++) total += pendingWithdrawals[identityIds[i]][recipient];
    }

    function getRoyaltyInfo(uint256 identityId, uint256 salePrice) external view returns (address[] memory recipients, uint256[] memory amounts) {
        uint16[] memory percentages;
        (recipients, percentages) = getSplits(identityId);
        amounts = new uint256[](recipients.length);
        uint256 royalty = (salePrice * getRoyaltyPercentage(identityId)) / BASIS_POINTS;
        uint256 distributed;
        for (uint256 i; i < recipients.length; i++) {
            amounts[i] = i == recipients.length - 1 ? royalty - distributed : (royalty * percentages[i]) / BASIS_POINTS;
            distributed += amounts[i];
        }
    }

    function _legacyConfigured(uint256 identityId) private view returns (bool) {
        if (address(legacySplitter) == address(0)) return false;
        try legacySplitter.isSecondaryRoyaltyConfigured(identityId) returns (bool configured) { return configured; }
        catch { return legacySplitter.isRoyaltyConfigured(identityId); }
    }

    function _loadLegacyRoyalty(uint256 identityId) private {
        if (_royalties[identityId].isActive || !_legacyConfigured(identityId)) return;
        (address[] memory recipients, uint16[] memory percentages) = legacySplitter.getSplits(identityId);
        RoyaltyConfig storage config = _royalties[identityId];
        config.royaltyPercentage = legacySplitter.getRoyaltyPercentage(identityId);
        config.isActive = true;
        for (uint256 i; i < recipients.length; i++) config.splits.push(Split(payable(recipients[i]), percentages[i]));
    }
}
