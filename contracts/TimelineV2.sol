// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./AccessControl.sol";

contract TimelineV2 is Ownable {
    struct TimelineData {
        uint256 id;
        uint256 organizationId;
        address creator;
        string name;
        string description;
        uint256 totalChapters;
        uint8 holderDiscount;
        bool isActive;
        uint256 createdAt;
    }

    struct ChapterData {
        uint256 chapterNumber;
        uint256 identityId;
        bool requiresPrevious;
        uint256 addedAt;
    }

    struct UserProgress {
        uint256 completedCount;
        uint256 lastCompletedAt;
        bool isComplete;
    }

    EyekonAccessControl public immutable accessControl;
    address public identityContract;
    uint256 private _timelineIdCounter;
    mapping(uint256 => TimelineData) public timelines;
    mapping(bytes32 => bool) public timelineNameUsed;
    mapping(uint256 => mapping(uint256 => ChapterData)) public timelineChapters;
    mapping(uint256 => mapping(uint256 => uint256)) public identityToChapter;
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) public hasCompletedChapter;
    mapping(uint256 => mapping(address => uint256[])) private _completedChapters;
    mapping(uint256 => mapping(address => UserProgress)) public userProgress;
    mapping(uint256 => uint256) public timelineHolderCount;

    event TimelineCreated(uint256 indexed timelineId, uint256 indexed organizationId, address indexed creator, string name, uint256 totalChapters, uint8 holderDiscount, uint256 createdAt);
    event ChapterAdded(uint256 indexed timelineId, uint256 indexed chapterNumber, uint256 indexed identityId, bool requiresPrevious, uint256 addedAt);
    event ChapterCompleted(uint256 indexed timelineId, uint256 indexed chapterNumber, address indexed user, uint256 completedAt);
    event TimelineCompleted(uint256 indexed timelineId, address indexed user, uint256 completedAt);
    event TimelineUpdated(uint256 indexed timelineId, string name, string description, uint8 holderDiscount, bool isActive);

    constructor(address accessControlAddress) Ownable(msg.sender) {
        require(accessControlAddress != address(0), "Invalid access control");
        accessControl = EyekonAccessControl(accessControlAddress);
    }

    modifier onlyIdentityContract() {
        require(msg.sender == identityContract, "Only identity contract");
        _;
    }

    function setIdentityContract(address identityAddress) external onlyOwner {
        require(identityAddress != address(0), "Invalid identity contract");
        identityContract = identityAddress;
    }

    function createTimeline(
        uint256 organizationId,
        string calldata name,
        string calldata description,
        uint256 totalChapters,
        uint8 holderDiscount
    ) external returns (uint256 timelineId) {
        require(
            accessControl.isOrganizationAdminOrOwner(organizationId, msg.sender),
            "Not an organization owner or admin"
        );
        require(bytes(name).length > 0, "Name cannot be empty");
        require(totalChapters > 0, "Must have at least one chapter");
        require(holderDiscount <= 100, "Discount cannot exceed 100%");
        bytes32 nameHash = _normalizedNameHash(name);
        require(!timelineNameUsed[nameHash], "Timeline name already exists");
        timelineNameUsed[nameHash] = true;

        timelineId = ++_timelineIdCounter;
        timelines[timelineId] = TimelineData({
            id: timelineId,
            organizationId: organizationId,
            creator: msg.sender,
            name: name,
            description: description,
            totalChapters: totalChapters,
            holderDiscount: holderDiscount,
            isActive: true,
            createdAt: block.timestamp
        });
        emit TimelineCreated(timelineId, organizationId, msg.sender, name, totalChapters, holderDiscount, block.timestamp);
    }

    function addChapter(uint256 timelineId, uint256 chapterNumber, uint256 identityId, bool requiresPrevious) external {
        TimelineData storage timeline = timelines[timelineId];
        require(timeline.creator == msg.sender, "Only creator can add chapters");
        require(chapterNumber > 0 && chapterNumber <= timeline.totalChapters, "Invalid chapter number");
        require(identityId != 0, "Invalid identity");
        require(timelineChapters[timelineId][chapterNumber].chapterNumber == 0, "Chapter already exists");
        require(identityToChapter[timelineId][identityId] == 0, "Identity already linked");
        timelineChapters[timelineId][chapterNumber] = ChapterData(chapterNumber, identityId, requiresPrevious, block.timestamp);
        identityToChapter[timelineId][identityId] = chapterNumber;
        emit ChapterAdded(timelineId, chapterNumber, identityId, requiresPrevious, block.timestamp);
    }

    function completeChapterByIdentity(uint256 timelineId, uint256 identityId, address user) external onlyIdentityContract {
        uint256 chapterNumber = identityToChapter[timelineId][identityId];
        require(chapterNumber != 0, "Identity is not a chapter");
        require(user != address(0), "Invalid user");
        require(!hasCompletedChapter[timelineId][user][chapterNumber], "Chapter already completed");
        ChapterData memory chapter = timelineChapters[timelineId][chapterNumber];
        if (chapter.requiresPrevious && chapterNumber > 1) {
            require(hasCompletedChapter[timelineId][user][chapterNumber - 1], "Previous chapter required");
        }

        UserProgress storage progress = userProgress[timelineId][user];
        if (progress.completedCount == 0) timelineHolderCount[timelineId]++;
        hasCompletedChapter[timelineId][user][chapterNumber] = true;
        _completedChapters[timelineId][user].push(chapterNumber);
        progress.completedCount++;
        progress.lastCompletedAt = block.timestamp;
        if (progress.completedCount == timelines[timelineId].totalChapters) {
            progress.isComplete = true;
            emit TimelineCompleted(timelineId, user, block.timestamp);
        }
        emit ChapterCompleted(timelineId, chapterNumber, user, block.timestamp);
    }

    function updateTimeline(uint256 timelineId, string calldata name, string calldata description, uint8 holderDiscount, bool active) external {
        TimelineData storage timeline = timelines[timelineId];
        require(timeline.creator == msg.sender, "Only creator can update timeline");
        require(bytes(name).length > 0, "Name cannot be empty");
        require(holderDiscount <= 100, "Discount cannot exceed 100%");
        bytes32 oldHash = _normalizedNameHash(timeline.name);
        bytes32 newHash = _normalizedNameHash(name);
        if (newHash != oldHash) {
            require(!timelineNameUsed[newHash], "Timeline name already exists");
            timelineNameUsed[oldHash] = false;
            timelineNameUsed[newHash] = true;
        }
        timeline.name = name;
        timeline.description = description;
        timeline.holderDiscount = holderDiscount;
        timeline.isActive = active;
        emit TimelineUpdated(timelineId, name, description, holderDiscount, active);
    }

    function getTimeline(uint256 timelineId) external view returns (TimelineData memory) { return timelines[timelineId]; }
    function getChapter(uint256 timelineId, uint256 chapterNumber) external view returns (ChapterData memory) { return timelineChapters[timelineId][chapterNumber]; }
    function getUserCompletedChapters(uint256 timelineId, address user) external view returns (uint256[] memory) { return _completedChapters[timelineId][user]; }
    function getUserProgress(uint256 timelineId, address user) external view returns (uint256[] memory, uint256, bool) {
        UserProgress memory progress = userProgress[timelineId][user];
        return (_completedChapters[timelineId][user], progress.completedCount, progress.isComplete);
    }
    function getTotalTimelines() external view returns (uint256) { return _timelineIdCounter; }

    function _normalizedNameHash(string memory name) private pure returns (bytes32) {
        bytes memory input = bytes(name);
        bytes memory normalized = new bytes(input.length);
        uint256 length;
        bool pendingSpace;
        for (uint256 i; i < input.length; i++) {
            bytes1 char = input[i];
            bool isSpace = char == 0x20 || char == 0x09 || char == 0x0a || char == 0x0d;
            if (isSpace) { if (length > 0) pendingSpace = true; continue; }
            if (pendingSpace) normalized[length++] = 0x20;
            pendingSpace = false;
            if (char >= 0x41 && char <= 0x5a) char = bytes1(uint8(char) + 32);
            normalized[length++] = char;
        }
        require(length > 0, "Name cannot be blank");
        assembly { mstore(normalized, length) }
        return keccak256(normalized);
    }
}
