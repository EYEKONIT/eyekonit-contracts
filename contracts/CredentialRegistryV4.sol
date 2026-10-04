// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./AccessControl.sol";

contract CredentialRegistryV4 is ReentrancyGuard, EIP712 {
    struct Attestation {
        bytes32 id;
        uint256 organizationId;
        address issuer;
        address recipient;
        bytes32 credentialHash;
        uint256 credentialTypeId;
        uint256 issuedAt;
        uint256 expiresAt;
        bool transferable;
        bool isRevoked;
        string revocationReason;
        uint256 revokedAt;
    }

    EyekonAccessControl public immutable accessControl;
    mapping(bytes32 => Attestation) public attestations;
    mapping(bytes32 => bool) public attestationExists;
    mapping(address => bytes32[]) private _recipientCredentials;
    mapping(address => mapping(bytes32 => bool)) private _recipientSeen;
    mapping(address => bytes32[]) private _issuerCredentials;
    mapping(uint256 => bytes32[]) private _organizationCredentials;
    uint256 private _issuanceNonce;
    mapping(bytes32 => bool) public usedIssuanceVouchers;
    bytes32 public constant ISSUANCE_VOUCHER_TYPEHASH = keccak256(
        "IssuanceVoucher(uint256 organizationId,address issuer,address authorizedRecipient,bytes32 credentialHash,uint256 credentialTypeId,uint256 expiresAt,bool transferable,bytes32 nonce,uint256 deadline)"
    );

    event CredentialIssued(bytes32 indexed attestationId, uint256 indexed organizationId, address indexed issuer, address recipient, bytes32 credentialHash, uint256 issuedAt, uint256 expiresAt);
    event CredentialRevoked(bytes32 indexed attestationId, address indexed revokedBy, string reason, uint256 revokedAt);
    event CredentialTransferred(bytes32 indexed attestationId, address indexed from, address indexed to);

    constructor(address accessControlAddress) EIP712("EYEKON Credential", "4") {
        require(accessControlAddress != address(0), "Invalid access control");
        accessControl = EyekonAccessControl(accessControlAddress);
    }

    // Duration starts at the mined block, not when a browser draft was prepared.
    function issueCredentialWithDuration(
        uint256 organizationId, address recipient, bytes32 credentialHash,
        uint256 credentialTypeId, uint256 duration, bool transferable
    ) external nonReentrant returns (bytes32) {
        require(accessControl.isOrganizationAdminOrOwner(organizationId, msg.sender), "Not an organization owner or admin");
        require(duration > 0, "Duration must be positive");
        return _issue(organizationId, msg.sender, recipient, credentialHash, credentialTypeId, block.timestamp + duration, transferable);
    }

    function batchIssueCredentialsWithDuration(
        uint256 organizationId, address[] calldata recipients, bytes32[] calldata credentialHashes,
        uint256 credentialTypeId, uint256 duration, bool transferable
    ) external nonReentrant returns (bytes32[] memory ids) {
        require(accessControl.isOrganizationAdminOrOwner(organizationId, msg.sender), "Not an organization owner or admin");
        require(duration > 0, "Duration must be positive");
        require(recipients.length > 0 && recipients.length == credentialHashes.length, "Invalid batch");
        uint256 expiresAt = block.timestamp + duration;
        ids = new bytes32[](recipients.length);
        for (uint256 i; i < recipients.length; i++) {
            ids[i] = _issue(organizationId, msg.sender, recipients[i], credentialHashes[i], credentialTypeId, expiresAt, transferable);
        }
    }

    function issueCredential(
        uint256 organizationId,
        address recipient,
        bytes32 credentialHash,
        uint256 credentialTypeId,
        uint256 expiresAt,
        bool transferable
    ) external nonReentrant returns (bytes32) {
        require(accessControl.isOrganizationAdminOrOwner(organizationId, msg.sender), "Not an organization owner or admin");
        return _issue(organizationId, msg.sender, recipient, credentialHash, credentialTypeId, expiresAt, transferable);
    }

    function batchIssueCredentials(
        uint256 organizationId,
        address[] calldata recipients,
        bytes32[] calldata credentialHashes,
        uint256 credentialTypeId,
        uint256 expiresAt,
        bool transferable
    ) external nonReentrant returns (bytes32[] memory ids) {
        require(accessControl.isOrganizationAdminOrOwner(organizationId, msg.sender), "Not an organization owner or admin");
        require(recipients.length > 0 && recipients.length == credentialHashes.length, "Invalid batch");
        ids = new bytes32[](recipients.length);
        for (uint256 i; i < recipients.length; i++) {
            ids[i] = _issue(organizationId, msg.sender, recipients[i], credentialHashes[i], credentialTypeId, expiresAt, transferable);
        }
    }

    function claimCredentialWithVoucher(
        uint256 organizationId,
        address issuer,
        address authorizedRecipient,
        bytes32 credentialHash,
        uint256 credentialTypeId,
        uint256 expiresAt,
        bool transferable,
        bytes32 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (bytes32) {
        require(deadline >= block.timestamp, "Invitation expired");
        require(
            authorizedRecipient == address(0) || authorizedRecipient == msg.sender,
            "Invitation is for another wallet"
        );
        require(
            accessControl.isOrganizationAdminOrOwner(organizationId, issuer),
            "Issuer is no longer authorized"
        );
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            ISSUANCE_VOUCHER_TYPEHASH,
            organizationId,
            issuer,
            authorizedRecipient,
            credentialHash,
            credentialTypeId,
            expiresAt,
            transferable,
            nonce,
            deadline
        )));
        require(!usedIssuanceVouchers[digest], "Invitation already used");
        require(ECDSA.recover(digest, signature) == issuer, "Invalid issuer signature");
        usedIssuanceVouchers[digest] = true;
        return _issue(organizationId, issuer, msg.sender, credentialHash, credentialTypeId, expiresAt, transferable);
    }

    function _issue(
        uint256 organizationId,
        address issuer,
        address recipient,
        bytes32 credentialHash,
        uint256 credentialTypeId,
        uint256 expiresAt,
        bool transferable
    ) private returns (bytes32 attestationId) {
        require(recipient != address(0), "Invalid recipient");
        require(credentialHash != bytes32(0), "Invalid credential hash");
        require(expiresAt == 0 || expiresAt > block.timestamp, "Expiry must be in the future");
        attestationId = keccak256(abi.encode(
            block.chainid, address(this), organizationId, issuer, recipient,
            credentialHash, credentialTypeId, ++_issuanceNonce
        ));
        attestations[attestationId] = Attestation({
            id: attestationId,
            organizationId: organizationId,
            issuer: issuer,
            recipient: recipient,
            credentialHash: credentialHash,
            credentialTypeId: credentialTypeId,
            issuedAt: block.timestamp,
            expiresAt: expiresAt,
            transferable: transferable,
            isRevoked: false,
            revocationReason: "",
            revokedAt: 0
        });
        attestationExists[attestationId] = true;
        _recipientCredentials[recipient].push(attestationId);
        _recipientSeen[recipient][attestationId] = true;
        _issuerCredentials[issuer].push(attestationId);
        _organizationCredentials[organizationId].push(attestationId);
        emit CredentialIssued(attestationId, organizationId, issuer, recipient, credentialHash, block.timestamp, expiresAt);
    }

    function revokeCredential(bytes32 attestationId, string calldata reason) external nonReentrant {
        require(attestationExists[attestationId], "Attestation does not exist");
        Attestation storage attestation = attestations[attestationId];
        require(
            attestation.issuer == msg.sender ||
                accessControl.isOrganizationAdminOrOwner(attestation.organizationId, msg.sender),
            "Not authorized to revoke"
        );
        require(!attestation.isRevoked, "Already revoked");
        require(bytes(reason).length > 0, "Reason required");
        attestation.isRevoked = true;
        attestation.revocationReason = reason;
        attestation.revokedAt = block.timestamp;
        emit CredentialRevoked(attestationId, msg.sender, reason, block.timestamp);
    }

    function transferCredential(bytes32 attestationId, address newRecipient) external nonReentrant {
        require(attestationExists[attestationId], "Attestation does not exist");
        require(newRecipient != address(0), "Invalid recipient");
        Attestation storage attestation = attestations[attestationId];
        require(attestation.recipient == msg.sender, "Only current recipient can transfer");
        require(newRecipient != msg.sender, "Cannot transfer to yourself");
        require(attestation.transferable, "Credential is not transferable");
        require(!attestation.isRevoked, "Cannot transfer revoked credential");
        require(attestation.expiresAt == 0 || block.timestamp < attestation.expiresAt, "Credential expired");
        address oldRecipient = attestation.recipient;
        attestation.recipient = newRecipient;
        if (!_recipientSeen[newRecipient][attestationId]) {
            _recipientSeen[newRecipient][attestationId] = true;
            _recipientCredentials[newRecipient].push(attestationId);
        }
        emit CredentialTransferred(attestationId, oldRecipient, newRecipient);
    }

    function verifyCredential(bytes32 attestationId) external view returns (bool, address, address, uint256, uint256, bool) {
        if (!attestationExists[attestationId]) return (false, address(0), address(0), 0, 0, false);
        Attestation memory item = attestations[attestationId];
        bool valid = !item.isRevoked && (item.expiresAt == 0 || block.timestamp < item.expiresAt);
        return (valid, item.issuer, item.recipient, item.issuedAt, item.expiresAt, item.isRevoked);
    }

    function isCredentialValid(bytes32 attestationId) external view returns (bool) {
        if (!attestationExists[attestationId]) return false;
        Attestation memory item = attestations[attestationId];
        return !item.isRevoked && (item.expiresAt == 0 || block.timestamp < item.expiresAt);
    }

    function getAttestation(bytes32 id) external view returns (Attestation memory) { return attestations[id]; }
    function getCredentialsByRecipient(address account) external view returns (bytes32[] memory ids) {
        bytes32[] storage history = _recipientCredentials[account];
        ids = new bytes32[](_currentRecipientCount(account));
        uint256 cursor;
        for (uint256 i; i < history.length; i++) {
            if (attestations[history[i]].recipient == account) ids[cursor++] = history[i];
        }
    }
    function _currentRecipientCount(address account) private view returns (uint256 count) {
        bytes32[] storage history = _recipientCredentials[account];
        for (uint256 i; i < history.length; i++) {
            if (attestations[history[i]].recipient == account) count++;
        }
    }
    function getCredentialsByIssuer(address account) external view returns (bytes32[] memory) { return _issuerCredentials[account]; }
    function getCredentialsByOrganization(uint256 organizationId) external view returns (bytes32[] memory) { return _organizationCredentials[organizationId]; }
    function getRecipientCredentialCount(address account) external view returns (uint256) { return _currentRecipientCount(account); }
    function getIssuerCredentialCount(address account) external view returns (uint256) { return _issuerCredentials[account].length; }
}
