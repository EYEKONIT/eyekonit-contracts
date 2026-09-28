// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title EYEKON AccessControl
 * @dev Manages role-based permissions for the EYEKON platform
 * Handles organization registration and member management
 */
contract EyekonAccessControl is AccessControl {
    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant ORG_OWNER_ROLE = keccak256("ORG_OWNER_ROLE");
    bytes32 public constant ORG_ADMIN_ROLE = keccak256("ORG_ADMIN_ROLE");
    bytes32 public constant ORG_MEMBER_ROLE = keccak256("ORG_MEMBER_ROLE");

    // Organization structure
    struct Organization {
        uint256 id;
        address owner;
        string name;
        bool isActive;
        uint256 createdAt;
    }

    // State variables
    uint256 private _orgIdCounter;
    mapping(uint256 => Organization) public organizations;
    mapping(address => uint256[]) public userOrganizations;
    mapping(uint256 => mapping(address => bytes32)) public orgMemberRoles;
    mapping(uint256 => address[]) public orgMembers;
    mapping(bytes32 => bool) private _organizationNameHashes; // Track used organization names

    // Events
    event OrganizationRegistered(uint256 indexed orgId, address indexed owner, string name);
    event OrganizationNameUpdated(uint256 indexed orgId, string oldName, string newName);
    event OrganizationDeactivated(uint256 indexed orgId, address indexed owner);
    event MemberAdded(uint256 indexed orgId, address indexed member, bytes32 role);
    event MemberRemoved(uint256 indexed orgId, address indexed member);
    event MemberRoleUpdated(uint256 indexed orgId, address indexed member, bytes32 newRole);
    event OwnershipTransferred(uint256 indexed orgId, address indexed oldOwner, address indexed newOwner);

    /**
     * @dev Constructor sets up the default admin role
     */
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    /**
     * @dev Register a new organization
     * @param name Organization name
     * @return orgId The ID of the newly created organization
     */
    function registerOrganization(string calldata name) external returns (uint256) { // Changed to calldata
        // Check for empty name
        require(bytes(name).length > 0, "Organization name cannot be empty");
        
        // Check for name uniqueness (case-insensitive via hash)
        bytes32 nameHash = keccak256(abi.encodePacked(_toLower(name)));
        require(!_organizationNameHashes[nameHash], "Organization name already exists");
        
        unchecked {
            _orgIdCounter++;
        }
        uint256 orgId = _orgIdCounter;

        organizations[orgId] = Organization({
            id: orgId,
            owner: msg.sender,
            name: name,
            isActive: true,
            createdAt: block.timestamp
        });

        userOrganizations[msg.sender].push(orgId);
        orgMemberRoles[orgId][msg.sender] = ORG_OWNER_ROLE;
        orgMembers[orgId].push(msg.sender);
        
        // Mark name as used
        _organizationNameHashes[nameHash] = true;

        // Grant roles to organization owner
        _grantRole(ORG_OWNER_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(ISSUER_ROLE, msg.sender);

        emit OrganizationRegistered(orgId, msg.sender, name);
        emit MemberAdded(orgId, msg.sender, ORG_OWNER_ROLE);

        return orgId;
    }

    /**
     * @dev Add a member to an organization
     * @param orgId Organization ID
     * @param member Address of the member to add
     * @param role Role to assign to the member
     */
    function addOrganizationMember(
        uint256 orgId,
        address member,
        bytes32 role
    ) external {
        require(organizations[orgId].isActive, "Organization does not exist");
        require(
            orgMemberRoles[orgId][msg.sender] == ORG_OWNER_ROLE ||
            orgMemberRoles[orgId][msg.sender] == ORG_ADMIN_ROLE,
            "Only owner or admin can add members"
        );
        require(
            role == ORG_ADMIN_ROLE || role == ORG_MEMBER_ROLE,
            "Invalid role for member"
        );
        require(orgMemberRoles[orgId][member] == bytes32(0), "Member already exists");

        orgMemberRoles[orgId][member] = role;
        orgMembers[orgId].push(member);
        userOrganizations[member].push(orgId);

        // Grant appropriate platform roles
        if (role == ORG_ADMIN_ROLE) {
            _grantRole(MINTER_ROLE, member);
            _grantRole(ISSUER_ROLE, member);
        }

        emit MemberAdded(orgId, member, role);
    }

    /**
     * @dev Remove a member from an organization
     * @param orgId Organization ID
     * @param member Address of the member to remove
     */
    function removeOrganizationMember(uint256 orgId, address member) external {
        require(organizations[orgId].isActive, "Organization does not exist");
        require(
            orgMemberRoles[orgId][msg.sender] == ORG_OWNER_ROLE,
            "Only owner can remove members"
        );
        require(member != organizations[orgId].owner, "Cannot remove owner");
        require(orgMemberRoles[orgId][member] != bytes32(0), "Member does not exist");

        bytes32 memberRole = orgMemberRoles[orgId][member];
        delete orgMemberRoles[orgId][member];

        // Remove from orgMembers array
        address[] storage members = orgMembers[orgId];
        uint256 length = members.length;
        for (uint256 i = 0; i < length;) {
            if (members[i] == member) {
                members[i] = members[length - 1];
                members.pop();
                break;
            }
            unchecked {
                i++;
            }
        }

        // Revoke platform roles if member is not in other organizations with admin role
        if (memberRole == ORG_ADMIN_ROLE) {
            bool hasOtherAdminRole = false;
            uint256[] memory userOrgs = userOrganizations[member];
            uint256 orgsLength = userOrgs.length;
            for (uint256 i = 0; i < orgsLength;) {
                if (userOrgs[i] != orgId && orgMemberRoles[userOrgs[i]][member] == ORG_ADMIN_ROLE) {
                    hasOtherAdminRole = true;
                    break;
                }
                unchecked {
                    i++;
                }
            }
            if (!hasOtherAdminRole) {
                _revokeRole(MINTER_ROLE, member);
                _revokeRole(ISSUER_ROLE, member);
            }
        }

        emit MemberRemoved(orgId, member);
    }

    /**
     * @dev Update a member's role in an organization
     * @param orgId Organization ID
     * @param member Address of the member
     * @param newRole New role to assign
     */
    function updateMemberRole(
        uint256 orgId,
        address member,
        bytes32 newRole
    ) external {
        require(organizations[orgId].isActive, "Organization does not exist");
        require(
            orgMemberRoles[orgId][msg.sender] == ORG_OWNER_ROLE,
            "Only owner can update roles"
        );
        require(member != organizations[orgId].owner, "Cannot change owner role");
        require(orgMemberRoles[orgId][member] != bytes32(0), "Member does not exist");
        require(
            newRole == ORG_ADMIN_ROLE || newRole == ORG_MEMBER_ROLE,
            "Invalid role"
        );

        bytes32 oldRole = orgMemberRoles[orgId][member];
        orgMemberRoles[orgId][member] = newRole;

        // Update platform roles
        if (newRole == ORG_ADMIN_ROLE && oldRole != ORG_ADMIN_ROLE) {
            _grantRole(MINTER_ROLE, member);
            _grantRole(ISSUER_ROLE, member);
        } else if (newRole == ORG_MEMBER_ROLE && oldRole == ORG_ADMIN_ROLE) {
            // Check if member has admin role in other organizations
            bool hasOtherAdminRole = false;
            uint256[] memory userOrgs = userOrganizations[member];
            uint256 orgsLength = userOrgs.length;
            for (uint256 i = 0; i < orgsLength;) {
                if (userOrgs[i] != orgId && orgMemberRoles[userOrgs[i]][member] == ORG_ADMIN_ROLE) {
                    hasOtherAdminRole = true;
                    break;
                }
                unchecked {
                    i++;
                }
            }
            if (!hasOtherAdminRole) {
                _revokeRole(MINTER_ROLE, member);
                _revokeRole(ISSUER_ROLE, member);
            }
        }

        emit MemberRoleUpdated(orgId, member, newRole);
    }

    /**
     * @dev Update organization name
     * @param orgId Organization ID
     * @param newName New organization name
     */
    function updateOrganizationName(
        uint256 orgId,
        string calldata newName
    ) external {
        require(organizations[orgId].isActive, "Organization does not exist");
        require(
            organizations[orgId].owner == msg.sender,
            "Only owner can update organization name"
        );
        require(bytes(newName).length > 0, "Organization name cannot be empty");
        
        // Check for name uniqueness (case-insensitive via hash)
        bytes32 newNameHash = keccak256(abi.encodePacked(_toLowerMemory(newName)));
        bytes32 oldNameHash = keccak256(abi.encodePacked(_toLowerMemory(organizations[orgId].name)));
        
        // If name is changing, check uniqueness
        if (newNameHash != oldNameHash) {
            require(!_organizationNameHashes[newNameHash], "Organization name already exists");
            
            // Free up old name
            _organizationNameHashes[oldNameHash] = false;
            // Reserve new name
            _organizationNameHashes[newNameHash] = true;
        }
        
        string memory oldName = organizations[orgId].name;
        organizations[orgId].name = newName;
        
        emit OrganizationNameUpdated(orgId, oldName, newName);
    }

    /**
     * @dev Deactivate an organization
     * @param orgId Organization ID
     */
    function deactivateOrganization(uint256 orgId) external {
        require(organizations[orgId].isActive, "Organization does not exist");
        require(
            organizations[orgId].owner == msg.sender,
            "Only owner can deactivate organization"
        );
        
        // Mark organization as inactive
        organizations[orgId].isActive = false;
        
        // Free up organization name for reuse
        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerMemory(organizations[orgId].name)));
        _organizationNameHashes[nameHash] = false;
        
        // Revoke all member roles
        address[] memory members = orgMembers[orgId];
        uint256 membersLength = members.length;
        for (uint256 i = 0; i < membersLength;) {
            address member = members[i];
            bytes32 memberRole = orgMemberRoles[orgId][member];
            
            // Delete member role
            delete orgMemberRoles[orgId][member];
            
            // Revoke platform roles if member has no other admin roles
            if (memberRole == ORG_ADMIN_ROLE || memberRole == ORG_OWNER_ROLE) {
                bool hasOtherAdminRole = false;
                uint256[] memory memberOrgs = userOrganizations[member];
                uint256 orgsLength = memberOrgs.length;
                for (uint256 j = 0; j < orgsLength;) {
                    if (memberOrgs[j] != orgId && organizations[memberOrgs[j]].isActive &&
                        (orgMemberRoles[memberOrgs[j]][member] == ORG_OWNER_ROLE ||
                         orgMemberRoles[memberOrgs[j]][member] == ORG_ADMIN_ROLE)) {
                        hasOtherAdminRole = true;
                        break;
                    }
                    unchecked {
                        j++;
                    }
                }
                if (!hasOtherAdminRole) {
                    _revokeRole(MINTER_ROLE, member);
                    _revokeRole(ISSUER_ROLE, member);
                }
            }
            
            unchecked {
                i++;
            }
        }
        
        emit OrganizationDeactivated(orgId, msg.sender);
    }

    /**
     * @dev Transfer organization ownership to a new owner
     * @param orgId Organization ID
     * @param newOwner Address of the new owner
     */
    function transferOrganizationOwnership(
        uint256 orgId,
        address newOwner
    ) external {
        require(organizations[orgId].isActive, "Organization does not exist");
        require(
            organizations[orgId].owner == msg.sender,
            "Only current owner can transfer ownership"
        );
        require(newOwner != address(0), "Invalid new owner address");
        require(newOwner != msg.sender, "Cannot transfer to yourself");
        require(
            orgMemberRoles[orgId][newOwner] != bytes32(0),
            "New owner must be a member"
        );
        
        address oldOwner = organizations[orgId].owner;
        
        // Update organization owner
        organizations[orgId].owner = newOwner;
        
        // Update roles
        orgMemberRoles[orgId][oldOwner] = ORG_ADMIN_ROLE;
        orgMemberRoles[orgId][newOwner] = ORG_OWNER_ROLE;
        
        // Grant platform roles to new owner
        _grantRole(MINTER_ROLE, newOwner);
        _grantRole(ISSUER_ROLE, newOwner);
        
        // Check if old owner has admin role in other organizations before revoking
        bool hasOtherAdminRole = false;
        uint256[] memory oldOwnerOrgs = userOrganizations[oldOwner];
        uint256 orgsLength = oldOwnerOrgs.length;
        for (uint256 i = 0; i < orgsLength;) {
            if (oldOwnerOrgs[i] != orgId && 
                (orgMemberRoles[oldOwnerOrgs[i]][oldOwner] == ORG_OWNER_ROLE ||
                 orgMemberRoles[oldOwnerOrgs[i]][oldOwner] == ORG_ADMIN_ROLE)) {
                hasOtherAdminRole = true;
                break;
            }
            unchecked {
                i++;
            }
        }
        
        // Only revoke if old owner has no other admin/owner roles
        if (!hasOtherAdminRole) {
            _revokeRole(MINTER_ROLE, oldOwner);
            _revokeRole(ISSUER_ROLE, oldOwner);
        }
        
        emit OwnershipTransferred(orgId, oldOwner, newOwner);
    }

    /**
     * @dev Check if an account can mint identities
     * @param account Address to check
     * @return bool True if account has minting permission
     */
    function canMintIdentity(address account) external view returns (bool) {
        return hasRole(MINTER_ROLE, account) || hasRole(ADMIN_ROLE, account);
    }

    /**
     * @dev Check if an account can issue credentials
     * @param account Address to check
     * @return bool True if account has issuing permission
     */
    function canIssueCredential(address account) external view returns (bool) {
        return hasRole(ISSUER_ROLE, account) || hasRole(ADMIN_ROLE, account);
    }

    /**
     * @dev Check if an account is a member of an organization
     * @param orgId Organization ID
     * @param account Address to check
     * @return bool True if account is a member
     */
    function isOrganizationMember(uint256 orgId, address account) external view returns (bool) {
        return orgMemberRoles[orgId][account] != bytes32(0);
    }

    /**
     * @dev Get organization details
     * @param orgId Organization ID
     * @return Organization struct
     */
    function getOrganization(uint256 orgId) external view returns (Organization memory) {
        require(organizations[orgId].isActive, "Organization does not exist");
        return organizations[orgId];
    }

    /**
     * @dev Get all organizations for a user
     * @param user User address
     * @return Array of organization IDs
     */
    function getUserOrganizations(address user) external view returns (uint256[] memory) {
        return userOrganizations[user];
    }

    /**
     * @dev Get all members of an organization
     * @param orgId Organization ID
     * @return Array of member addresses
     */
    function getOrganizationMembers(uint256 orgId) external view returns (address[] memory) {
        require(organizations[orgId].isActive, "Organization does not exist");
        return orgMembers[orgId];
    }

    /**
     * @dev Get a member's role in an organization
     * @param orgId Organization ID
     * @param member Member address
     * @return Role bytes32
     */
    function getMemberRole(uint256 orgId, address member) external view returns (bytes32) {
        return orgMemberRoles[orgId][member];
    }

    /**
     * @dev Get total number of organizations
     * @return uint256 Total organizations count
     */
    function getTotalOrganizations() external view returns (uint256) {
        return _orgIdCounter;
    }
    
    /**
     * @dev Convert string to lowercase for case-insensitive comparison (calldata version)
     * @param str Input string
     * @return string Lowercase string
     */
    function _toLower(string calldata str) private pure returns (string memory) {
        bytes memory bStr = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        
        for (uint256 i = 0; i < bStr.length; i++) {
            // Convert uppercase A-Z to lowercase a-z
            if (bStr[i] >= 0x41 && bStr[i] <= 0x5A) {
                bLower[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                bLower[i] = bStr[i];
            }
        }
        
        return string(bLower);
    }
    
    /**
     * @dev Convert string to lowercase for case-insensitive comparison (memory version)
     * @param str Input string
     * @return string Lowercase string
     */
    function _toLowerMemory(string memory str) private pure returns (string memory) {
        bytes memory bStr = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        
        for (uint256 i = 0; i < bStr.length; i++) {
            // Convert uppercase A-Z to lowercase a-z
            if (bStr[i] >= 0x41 && bStr[i] <= 0x5A) {
                bLower[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                bLower[i] = bStr[i];
            }
        }
        
        return string(bLower);
    }
}
