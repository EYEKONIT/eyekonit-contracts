// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EYEKON Timeline
 * @dev Manages evolution timelines with chapter progression and holder benefits
 */
contract Timeline is Ownable, ReentrancyGuard {
    struct TimelineData {
        uint256 timelineId;
        uint256 organizationId;
        string name;
        string description;
        uint256 totalChapters;
        uint8 holderDiscount; // Discount percentage for timeline holders (0-100)
        bool isActive;
        uint256 createdAt;
    }

    struct ChapterData {
        uint256 chapterNumber;
        uint256 identityId; // Reference to IdentityNFT
        bool requiresPrevious;
        uint256 addedAt;
    }

    struct UserProgress {
        uint256[] completedChapters;
        uint256 lastCompletedAt;
        bool isComplete;
    }

    // State variables
    uint256 private nextTimelineId = 1;
    mapping(uint256 => TimelineData) public timelines;
    mapping(uint256 => mapping(uint256 => ChapterData)) public timelineChapters; // timelineId => chapterNumber => ChapterData
    mapping(uint256 => mapping(address => UserProgress)) public userProgress; // timelineId => user => progress
    mapping(uint256 => uint256) public timelineHolderCount; // timelineId => holder count
    mapping(uint256 => address) public timelineCreator; // timelineId => creator address

    /**
     * @dev Constructor
     */
    constructor() Ownable(msg.sender) {}

    // Events
    event TimelineCreated(
        uint256 indexed timelineId,
        uint256 indexed organizationId,
        string name,
        uint256 totalChapters,
        uint8 holderDiscount,
        address creator,
        uint256 createdAt
    );

    event ChapterAdded(
        uint256 indexed timelineId,
        uint256 chapterNumber,
        uint256 identityId,
        bool requiresPrevious,
        uint256 addedAt
    );

    event ChapterCompleted(
        uint256 indexed timelineId,
        uint256 chapterNumber,
        address indexed user,
        uint256 completedAt
    );

    event TimelineCompleted(
        uint256 indexed timelineId,
        address indexed user,
        uint256 completedAt
    );

    event TimelineUpdated(
        uint256 indexed timelineId,
        string name,
        string description,
        uint8 holderDiscount,
        bool isActive
    );

    /**
     * @dev Create a new timeline
     */
    function createTimeline(
        uint256 organizationId,
        string memory name,
        string memory description,
        uint256 totalChapters,
        uint8 holderDiscount
    ) external returns (uint256) {
        require(bytes(name).length > 0, "Name cannot be empty");
        require(totalChapters > 0, "Must have at least one chapter");
        require(holderDiscount <= 100, "Discount cannot exceed 100%");

        uint256 timelineId = nextTimelineId++;

        timelines[timelineId] = TimelineData({
            timelineId: timelineId,
            organizationId: organizationId,
            name: name,
            description: description,
            totalChapters: totalChapters,
            holderDiscount: holderDiscount,
            isActive: true,
            createdAt: block.timestamp
        });

        timelineCreator[timelineId] = msg.sender;

        emit TimelineCreated(
            timelineId,
            organizationId,
            name,
            totalChapters,
            holderDiscount,
            msg.sender,
            block.timestamp
        );

        return timelineId;
    }

    /**
     * @dev Add a chapter to a timeline
     */
    function addChapter(
        uint256 timelineId,
        uint256 chapterNumber,
        uint256 identityId,
        bool requiresPrevious
    ) external {
        require(timelines[timelineId].timelineId != 0, "Timeline does not exist");
        require(timelineCreator[timelineId] == msg.sender, "Only creator can add chapters");
        require(chapterNumber > 0 && chapterNumber <= timelines[timelineId].totalChapters, "Invalid chapter number");
        require(timelineChapters[timelineId][chapterNumber].chapterNumber == 0, "Chapter already exists");

        timelineChapters[timelineId][chapterNumber] = ChapterData({
            chapterNumber: chapterNumber,
            identityId: identityId,
            requiresPrevious: requiresPrevious,
            addedAt: block.timestamp
        });

        emit ChapterAdded(
            timelineId,
            chapterNumber,
            identityId,
            requiresPrevious,
            block.timestamp
        );
    }

    /**
     * @dev Record chapter completion for a user
     */
    function completeChapter(
        uint256 timelineId,
        uint256 chapterNumber,
        address user
    ) external {
        require(timelines[timelineId].timelineId != 0, "Timeline does not exist");
        require(timelineChapters[timelineId][chapterNumber].chapterNumber != 0, "Chapter does not exist");

        UserProgress storage progress = userProgress[timelineId][user];

        // Check if already completed
        for (uint256 i = 0; i < progress.completedChapters.length; i++) {
            require(progress.completedChapters[i] != chapterNumber, "Chapter already completed");
        }

        // Add to completed chapters
        progress.completedChapters.push(chapterNumber);
        progress.lastCompletedAt = block.timestamp;

        // Update holder count if this is their first chapter
        if (progress.completedChapters.length == 1) {
            timelineHolderCount[timelineId]++;
        }

        // Check if timeline is complete
        if (progress.completedChapters.length == timelines[timelineId].totalChapters) {
            progress.isComplete = true;
            emit TimelineCompleted(timelineId, user, block.timestamp);
        }

        emit ChapterCompleted(timelineId, chapterNumber, user, block.timestamp);
    }

    /**
     * @dev Update timeline details
     */
    function updateTimeline(
        uint256 timelineId,
        string memory name,
        string memory description,
        uint8 holderDiscount,
        bool isActive
    ) external {
        require(timelines[timelineId].timelineId != 0, "Timeline does not exist");
        require(timelineCreator[timelineId] == msg.sender, "Only creator can update timeline");
        require(holderDiscount <= 100, "Discount cannot exceed 100%");

        TimelineData storage timeline = timelines[timelineId];
        timeline.name = name;
        timeline.description = description;
        timeline.holderDiscount = holderDiscount;
        timeline.isActive = isActive;

        emit TimelineUpdated(timelineId, name, description, holderDiscount, isActive);
    }

    /**
     * @dev Get user's completed chapters
     */
    function getUserCompletedChapters(uint256 timelineId, address user) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return userProgress[timelineId][user].completedChapters;
    }

    /**
     * @dev Check if user has completed a specific chapter
     */
    function hasCompletedChapter(
        uint256 timelineId,
        uint256 chapterNumber,
        address user
    ) external view returns (bool) {
        uint256[] memory completed = userProgress[timelineId][user].completedChapters;
        for (uint256 i = 0; i < completed.length; i++) {
            if (completed[i] == chapterNumber) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Check if user is eligible for holder discount
     */
    function isEligibleForDiscount(
        uint256 timelineId,
        uint256 chapterNumber,
        address user
    ) external view returns (bool, uint8) {
        if (chapterNumber == 1) {
            return (false, 0);
        }

        TimelineData memory timeline = timelines[timelineId];
        if (timeline.holderDiscount == 0) {
            return (false, 0);
        }

        // Check if user completed previous chapter
        uint256[] memory completed = userProgress[timelineId][user].completedChapters;
        for (uint256 i = 0; i < completed.length; i++) {
            if (completed[i] == chapterNumber - 1) {
                return (true, timeline.holderDiscount);
            }
        }

        return (false, 0);
    }

    /**
     * @dev Get timeline details
     */
    function getTimeline(uint256 timelineId) 
        external 
        view 
        returns (TimelineData memory) 
    {
        require(timelines[timelineId].timelineId != 0, "Timeline does not exist");
        return timelines[timelineId];
    }

    /**
     * @dev Get chapter details
     */
    function getChapter(uint256 timelineId, uint256 chapterNumber) 
        external 
        view 
        returns (ChapterData memory) 
    {
        require(timelineChapters[timelineId][chapterNumber].chapterNumber != 0, "Chapter does not exist");
        return timelineChapters[timelineId][chapterNumber];
    }

    /**
     * @dev Get user progress
     */
    function getUserProgress(uint256 timelineId, address user) 
        external 
        view 
        returns (
            uint256[] memory completedChapters,
            uint256 lastCompletedAt,
            bool isComplete
        ) 
    {
        UserProgress memory progress = userProgress[timelineId][user];
        return (
            progress.completedChapters,
            progress.lastCompletedAt,
            progress.isComplete
        );
    }

    /**
     * @dev Get timeline holder count
     */
    function getHolderCount(uint256 timelineId) external view returns (uint256) {
        return timelineHolderCount[timelineId];
    }
}
