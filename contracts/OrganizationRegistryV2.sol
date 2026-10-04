// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AccessControl.sol";

/**
 * Immutable organization definitions with the existing protocol's role ledger.
 * This contract owns its backing organizations. It never forwards name changes,
 * deactivation, or ownership of the backing record to an externally owned wallet.
 * Existing identities, credentials, royalties and holders keep their addresses.
 * Human ownership and membership management remain explicit in this registry.
 */
contract OrganizationRegistryV2 {
    EyekonAccessControl public immutable legacyAccessControl;
    bytes32 public constant ORG_OWNER_ROLE = keccak256("ORG_OWNER_ROLE");
    bytes32 public constant ORG_ADMIN_ROLE = keccak256("ORG_ADMIN_ROLE");
    bytes32 public constant ORG_MEMBER_ROLE = keccak256("ORG_MEMBER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    struct Adoption { address owner; bytes32 definitionHash; }
    mapping(uint256 => address) private _owners;
    mapping(uint256 => Adoption) public pendingAdoptions;
    mapping(uint256 => uint256) public parentOrganizationIds;
    event OrganizationRegistered(uint256 indexed orgId, address indexed owner, string name);
    event MemberAdded(uint256 indexed orgId, address indexed member, bytes32 role);
    event MemberRemoved(uint256 indexed orgId, address indexed member);
    event MemberRoleUpdated(uint256 indexed orgId, address indexed member, bytes32 newRole);
    event OwnershipTransferred(uint256 indexed orgId, address indexed oldOwner, address indexed newOwner);
    event OrganizationParentLinked(uint256 indexed orgId, uint256 indexed parentOrgId);
    event LegacyOrganizationAdopted(uint256 indexed orgId, address indexed owner);

    constructor(address legacyAddress) {
        require(legacyAddress.code.length > 0, "Invalid role ledger");
        legacyAccessControl = EyekonAccessControl(legacyAddress);
    }

    function registryVersion() external pure returns (uint256) { return 2; }
    function registerOrganization(string calldata name) external returns (uint256) {
        return _register(name, 0);
    }
    function registerSubOrganization(string calldata name, uint256 parentId) external returns (uint256) {
        require(_owners[parentId] != address(0), "Parent is not registered");
        require(isOrganizationAdminOrOwner(parentId, msg.sender), "Not a parent owner or admin");
        uint256 depth; uint256 ancestor = parentId;
        while (ancestor != 0) { require(++depth <= 16, "Maximum department depth reached"); ancestor = parentOrganizationIds[ancestor]; }
        return _register(name, parentId);
    }
    function _register(string calldata name, uint256 parentId) private returns (uint256 id) {
        require(bytes(name).length >= 2 && bytes(name).length <= 200, "Invalid organization name");
        require(bytes(name)[0] != 0x20 && bytes(name)[bytes(name).length - 1] != 0x20, "Trim organization name");
        id = legacyAccessControl.registerOrganization(name);
        _owners[id] = msg.sender;
        parentOrganizationIds[id] = parentId;
        legacyAccessControl.addOrganizationMember(id, msg.sender, ORG_ADMIN_ROLE);
        emit OrganizationRegistered(id, msg.sender, name);
        emit MemberAdded(id, msg.sender, ORG_OWNER_ROLE);
        if (parentId != 0) emit OrganizationParentLinked(id, parentId);
    }

    // Adoption is initiated by the actual legacy owner, and cannot be forged by
    // a deployment administrator. The owner subsequently transfers the backing
    // organization to this contract using the legacy contract's existing flow.
    function prepareLegacyAdoption(uint256 id) external {
        require(_owners[id] == address(0), "Organization already adopted");
        EyekonAccessControl.Organization memory original = legacyAccessControl.getOrganization(id);
        require(original.owner == msg.sender, "Only legacy owner");
        pendingAdoptions[id] = Adoption(msg.sender, _definitionHash(original));
    }
    function finalizeLegacyAdoption(uint256 id) external {
        Adoption memory pending = pendingAdoptions[id];
        require(pending.owner != address(0) && _owners[id] == address(0), "No pending adoption");
        EyekonAccessControl.Organization memory original = legacyAccessControl.getOrganization(id);
        require(original.owner == address(this), "Backing ownership not transferred");
        require(_definitionHash(original) == pending.definitionHash, "Organization definition changed");
        require(legacyAccessControl.getMemberRole(id, pending.owner) == ORG_ADMIN_ROLE, "Original owner role changed");
        _owners[id] = pending.owner;
        delete pendingAdoptions[id];
        emit LegacyOrganizationAdopted(id, pending.owner);
    }
    function _definitionHash(EyekonAccessControl.Organization memory org) private pure returns (bytes32) {
        return keccak256(abi.encode(org.id, org.name, org.isActive, org.createdAt));
    }
    function updateOrganizationName(uint256, string calldata) external pure { revert("Published organization information is immutable"); }
    function deactivateOrganization(uint256) external pure { revert("Published organizations cannot be deleted"); }
    function addOrganizationMember(uint256 id, address member, bytes32 role) external {
        require(isOrganizationAdminOrOwner(id, msg.sender), "Only owner or admin can add members");
        require(member != address(0) && member != address(this), "Invalid member");
        legacyAccessControl.addOrganizationMember(id, member, role);
        emit MemberAdded(id, member, role);
    }
    function removeOrganizationMember(uint256 id, address member) external {
        require(_owners[id] != address(0) && _owners[id] == msg.sender, "Only owner can remove members");
        require(member != _owners[id] && member != address(this), "Cannot remove owner");
        legacyAccessControl.removeOrganizationMember(id, member);
        emit MemberRemoved(id, member);
    }
    function updateMemberRole(uint256 id, address member, bytes32 role) external {
        require(_owners[id] != address(0) && _owners[id] == msg.sender, "Only owner can update roles");
        require(member != _owners[id] && member != address(this), "Cannot change owner role");
        legacyAccessControl.updateMemberRole(id, member, role);
        emit MemberRoleUpdated(id, member, role);
    }
    function transferOrganizationOwnership(uint256 id, address nextOwner) external {
        require(_owners[id] != address(0) && _owners[id] == msg.sender, "Only current owner can transfer ownership");
        require(nextOwner != address(0) && nextOwner != address(this) && nextOwner != msg.sender, "Invalid new owner");
        require(getMemberRole(id, nextOwner) != bytes32(0), "New owner must be a member");
        if (legacyAccessControl.getMemberRole(id, nextOwner) != ORG_ADMIN_ROLE) legacyAccessControl.updateMemberRole(id, nextOwner, ORG_ADMIN_ROLE);
        _owners[id] = nextOwner;
        emit OwnershipTransferred(id, msg.sender, nextOwner);
    }
    function getMemberRole(uint256 id, address member) public view returns (bytes32) {
        if (_owners[id] == address(0) || member == address(this)) return bytes32(0);
        if (member == _owners[id]) return ORG_OWNER_ROLE;
        return legacyAccessControl.getMemberRole(id, member);
    }
    function orgMemberRoles(uint256 id, address member) external view returns (bytes32) { return getMemberRole(id, member); }
    function isOrganizationAdminOrOwner(uint256 id, address account) public view returns (bool) {
        bytes32 role = getMemberRole(id, account);
        return role == ORG_OWNER_ROLE || role == ORG_ADMIN_ROLE;
    }
    function isOrganizationMember(uint256 id, address account) external view returns (bool) { return getMemberRole(id, account) != bytes32(0); }
    function getOrganization(uint256 id) public view returns (EyekonAccessControl.Organization memory org) {
        require(_owners[id] != address(0), "Organization is not registered");
        org = legacyAccessControl.getOrganization(id); org.owner = _owners[id];
    }
    function organizations(uint256 id) external view returns (EyekonAccessControl.Organization memory) { return getOrganization(id); }
    function getOrganizationOwner(uint256 id) external view returns (address) { return getOrganization(id).owner; }
    function getOrganizationMembers(uint256 id) external view returns (address[] memory members) {
        require(_owners[id] != address(0), "Organization is not registered");
        address[] memory backing = legacyAccessControl.getOrganizationMembers(id);
        uint256 count; for (uint256 i; i < backing.length; i++) if (backing[i] != address(this)) count++;
        members = new address[](count); uint256 index;
        for (uint256 i; i < backing.length; i++) if (backing[i] != address(this)) members[index++] = backing[i];
    }
    function getUserOrganizations(address user) external view returns (uint256[] memory ids) {
        uint256[] memory backing = legacyAccessControl.getUserOrganizations(user);
        uint256 count; for (uint256 i; i < backing.length; i++) if (getMemberRole(backing[i], user) != bytes32(0)) count++;
        ids = new uint256[](count); uint256 index;
        for (uint256 i; i < backing.length; i++) {
            if (getMemberRole(backing[i], user) == bytes32(0)) continue;
            bool duplicate; for (uint256 j; j < index; j++) if (ids[j] == backing[i]) duplicate = true;
            if (!duplicate) ids[index++] = backing[i];
        }
        assembly { mstore(ids, index) }
    }
    function getTotalOrganizations() external view returns (uint256) { return legacyAccessControl.getTotalOrganizations(); }
    function hasRole(bytes32 role, address account) external view returns (bool) { return legacyAccessControl.hasRole(role, account); }
    function canMintIdentity(address account) external view returns (bool) { return legacyAccessControl.canMintIdentity(account); }
    function canIssueCredential(address account) external view returns (bool) { return legacyAccessControl.canIssueCredential(account); }
}
