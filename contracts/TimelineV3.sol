// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./AccessControl.sol";
import "./TimelineV2.sol";
import "./IdentityNFTV2.sol";

interface ITimelineV3IdentityBalances {
    function balanceOfIdentity(address account, uint256 identityId) external view returns (uint256);
    function timeline() external view returns (address);
}

contract TimelineV3 is Ownable {
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
    TimelineV2 public immutable legacyTimeline;
    uint256 public immutable legacyTimelineCount;
    bool public migrationComplete;
    mapping(uint256 => bytes32) public legacySnapshotHash;
    mapping(uint256 => mapping(address => bool)) public legacyProgressImported;
    event LegacyTimelineImported(uint256 indexed timelineId, address indexed creator);
    event LegacyProgressImported(uint256 indexed timelineId, address indexed user);
    uint256 internal _timelineIdCounter;
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

    constructor(address accessControlAddress, address legacyAddress) Ownable(msg.sender) {
        require(accessControlAddress != address(0), "Invalid access control");
        accessControl = EyekonAccessControl(accessControlAddress);
        require(legacyAddress != address(0), "Invalid legacy timeline");
        legacyTimeline = TimelineV2(legacyAddress);
        require(address(legacyTimeline.accessControl()) == accessControlAddress, "Legacy access mismatch");
        legacyTimelineCount = legacyTimeline.getTotalTimelines();
        migrationComplete = legacyTimelineCount == 0;
    }


    // Pre-launch import preserves IDs and authority. Existing progress must never be silently erased.
    function importLegacyTimeline(uint256 id) external onlyOwner {
        require(!migrationComplete, "Migration already complete");
        require(id == _timelineIdCounter + 1 && id <= legacyTimelineCount, "Import sequential legacy IDs");
        TimelineV2.TimelineData memory original = legacyTimeline.getTimeline(id);
        require(original.id == id && original.totalChapters <= 100, "Unsupported legacy timeline");
        bytes32 nameHash = _normalizedNameHash(original.name);
        require(!timelineNameUsed[nameHash], "Timeline name already exists");
        timelineNameUsed[nameHash] = true;
        timelines[id] = TimelineData(original.id, original.organizationId, original.creator, original.name, original.description, original.totalChapters, original.holderDiscount, original.isActive, original.createdAt);
        for(uint256 chapterNumber = 1; chapterNumber <= original.totalChapters; chapterNumber++) {
            TimelineV2.ChapterData memory chapter = legacyTimeline.getChapter(id, chapterNumber);
            if(chapter.identityId == 0) continue;
            timelineChapters[id][chapterNumber] = ChapterData(chapter.chapterNumber, chapter.identityId, chapter.requiresPrevious, chapter.addedAt);
            identityToChapter[id][chapter.identityId] = chapterNumber;
        }
        _timelineIdCounter = id;
        legacySnapshotHash[id] = _legacySnapshot(id);
        emit LegacyTimelineImported(id, original.creator);
    }

    function importLegacyProgress(uint256 id, address user) external onlyOwner {
        require(!migrationComplete && id > 0 && id <= _timelineIdCounter, "Invalid migration timeline");
        require(!legacyProgressImported[id][user], "Progress already imported");
        require(ITimelineV3IdentityBalances(legacyTimeline.identityContract()).timeline() == address(this) && ITimelineV3IdentityBalances(identityContract).timeline() == address(this), "Freeze legacy claims first");
        (uint256[] memory completed, uint256 count, bool complete) = legacyTimeline.getUserProgress(id, user);
        require(count > 0 && count == completed.length, "No valid legacy progress");
        (, uint256 lastCompletedAt,) = legacyTimeline.userProgress(id, user);
        for(uint256 i; i < completed.length; i++) {
            uint256 chapter = completed[i];
            require(chapter > 0 && chapter <= timelines[id].totalChapters && !hasCompletedChapter[id][user][chapter], "Invalid legacy chapter");
            hasCompletedChapter[id][user][chapter] = true;
            _completedChapters[id][user].push(chapter);
        }
        userProgress[id][user] = UserProgress(count, lastCompletedAt, complete);
        timelineHolderCount[id]++;
        legacyProgressImported[id][user] = true;
        emit LegacyProgressImported(id,user);
    }

    function finalizeMigration() external onlyOwner {
        require(!migrationComplete, "Migration already complete");
        require(_timelineIdCounter == legacyTimelineCount && legacyTimeline.getTotalTimelines() == legacyTimelineCount, "Legacy timeline count changed");
        require(ITimelineV3IdentityBalances(legacyTimeline.identityContract()).timeline() == address(this) && ITimelineV3IdentityBalances(identityContract).timeline() == address(this), "Freeze legacy claims first");
        for(uint256 id = 1; id <= legacyTimelineCount; id++) {
            require(legacySnapshotHash[id] == _legacySnapshot(id), "Legacy timeline changed");
            require(timelineHolderCount[id] == legacyTimeline.timelineHolderCount(id), "Legacy progress not fully imported");
        }
        migrationComplete = true;
    }

    function _legacySnapshot(uint256 id) private view returns (bytes32 hash) {
        TimelineV2.TimelineData memory original = legacyTimeline.getTimeline(id);
        hash = keccak256(abi.encode(original));
        for(uint256 chapter = 1; chapter <= original.totalChapters; chapter++) hash = keccak256(abi.encode(hash,legacyTimeline.getChapter(id,chapter)));
    }

    modifier ready() { require(migrationComplete, "Migration incomplete"); _; }

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
    ) external ready returns (uint256 timelineId) {
        require(_timelineIdCounter >= legacyTimelineCount, "Import legacy timelines first");
        require(
            accessControl.isOrganizationAdminOrOwner(organizationId, msg.sender),
            "Not an organization owner or admin"
        );
        require(bytes(name).length > 0, "Name cannot be empty");
        require(totalChapters > 0 && totalChapters <= 100, "Invalid chapter plan");
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

    function addChapter(uint256 timelineId, uint256 chapterNumber, uint256 identityId, bool requiresPrevious) external ready {
        TimelineData storage timeline = timelines[timelineId];
        require(timeline.creator == msg.sender, "Only creator can add chapters");
        require(timeline.isActive, "Timeline inactive");
        require(chapterNumber > 0 && chapterNumber <= timeline.totalChapters, "Invalid chapter number");
        require(identityId != 0, "Invalid identity");
        require(timelineChapters[timelineId][chapterNumber].chapterNumber == 0, "Chapter already exists");
        require(identityToChapter[timelineId][identityId] == 0, "Identity already linked");
        require(!requiresPrevious || chapterNumber > 1, "First chapter cannot require previous");
        if (requiresPrevious) require(timelineChapters[timelineId][chapterNumber - 1].identityId != 0, "Previous chapter missing");
        IdentityNFTV2.Identity memory identity = IdentityNFTV2(payable(identityContract)).getIdentity(identityId);
        require(identity.id == identityId && identity.creator == msg.sender && identity.organizationId == timeline.organizationId, "Chapter creator or organization mismatch");
        require(identity.requiredPreviousId == (requiresPrevious ? timelineChapters[timelineId][chapterNumber-1].identityId : 0), "Chapter dependency mismatch");
        require(IdentityNFTV2(payable(identityContract)).identityToTimeline(identityId) == 0, "Identity already linked to a timeline");
        timelineChapters[timelineId][chapterNumber] = ChapterData(chapterNumber, identityId, requiresPrevious, block.timestamp);
        identityToChapter[timelineId][identityId] = chapterNumber;
        emit ChapterAdded(timelineId, chapterNumber, identityId, requiresPrevious, block.timestamp);
    }

    function completeChapterByIdentity(uint256 timelineId, uint256 identityId, address user) external onlyIdentityContract ready {
        require(timelines[timelineId].isActive, "Timeline inactive");
        uint256 chapterNumber = identityToChapter[timelineId][identityId];
        require(chapterNumber != 0, "Identity is not a chapter");
        require(user != address(0), "Invalid user");
        // Editions may be transferred and claimed again. Progress is recorded once,
        // while claim eligibility depends on the current previous NFT holding.
        if (hasCompletedChapter[timelineId][user][chapterNumber]) return;
        ChapterData memory chapter = timelineChapters[timelineId][chapterNumber];
        if (chapter.requiresPrevious && chapterNumber > 1) {
            uint256 previousIdentityId = timelineChapters[timelineId][chapterNumber - 1].identityId;
            require(previousIdentityId != 0 && ITimelineV3IdentityBalances(identityContract).balanceOfIdentity(user, previousIdentityId) > 0, "Previous chapter required");
        }

        UserProgress storage progress = userProgress[timelineId][user];
        if (progress.completedCount == 0) timelineHolderCount[timelineId]++;
        hasCompletedChapter[timelineId][user][chapterNumber] = true;
        _completedChapters[timelineId][user].push(chapterNumber);
        progress.completedCount++;
        progress.lastCompletedAt = block.timestamp;
        // A transferred prerequisite gives genuine ownership without inventing
        // a historical claim. Completing the journey follows current holdings.
        bool ownsAll = true;
        for (uint256 number = 1; number <= timelines[timelineId].totalChapters; number++) {
            uint256 chapterIdentityId = timelineChapters[timelineId][number].identityId;
            if (chapterIdentityId == 0 || ITimelineV3IdentityBalances(identityContract).balanceOfIdentity(user, chapterIdentityId) == 0) { ownsAll = false; break; }
        }
        if (ownsAll && !progress.isComplete) {
            progress.isComplete = true;
            emit TimelineCompleted(timelineId, user, block.timestamp);
        }
        emit ChapterCompleted(timelineId, chapterNumber, user, block.timestamp);
    }

    function updateTimeline(uint256, string calldata, string calldata, uint8, bool) external pure {
        revert("Published timeline information is immutable");
    }

    function getTimeline(uint256 timelineId) external view returns (TimelineData memory) { return timelines[timelineId]; }
    function getChapter(uint256 timelineId, uint256 chapterNumber) external view returns (ChapterData memory) { return timelineChapters[timelineId][chapterNumber]; }
    function getUserCompletedChapters(uint256 timelineId, address user) external view returns (uint256[] memory) { return _completedChapters[timelineId][user]; }
    function getUserProgress(uint256 timelineId, address user) external view returns (uint256[] memory, uint256, bool) {
        UserProgress memory progress = userProgress[timelineId][user];
        return (_completedChapters[timelineId][user], progress.completedCount, progress.isComplete);
    }
    function getTotalTimelines() external view returns (uint256) { return _timelineIdCounter; }

    function _normalizedNameHash(string memory name) internal pure returns (bytes32) {
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
