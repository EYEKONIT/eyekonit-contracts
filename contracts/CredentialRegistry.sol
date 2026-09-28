// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AccessControl.sol";

/**
 * @title EYEKON CredentialRegistry
 * @dev Manages on-chain credential attestations with issuance, revocation, and verification
 */
contract CredentialRegistry is Ownable, ReentrancyGuard {
    // Attestation structure
    struct Attestation {
        bytes32 id;
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

    // State variables
    EyekonAccessControl public immutable accessControl; // Made immutable for gas savings
    
    mapping(bytes32 => Attestation) public attestations;
    mapping(address => bytes32[]) public recipientCredentials;
    mapping(address => bytes32[]) public issuerCredentials;
    mapping(bytes32 => bool) public attestationExists;

    // Events
    event CredentialIssued(
        bytes32 indexed attestationId,
        address indexed issuer,
        address indexed recipient,
        bytes32 credentialHash,
        uint256 issuedAt,
        uint256 expiresAt
    );
    
    event CredentialRevoked(
        bytes32 indexed attestationId,
        address indexed issuer,
        string reason,
        uint256 revokedAt
    );
    
    event CredentialTransferred(
        bytes32 indexed attestationId,
        address indexed from,
        address indexed to
    );

    /**
     * @dev Constructor
     * @param _accessControl Address of the AccessControl contract
     */
    constructor(address _accessControl) Ownable(msg.sender) {
        accessControl = EyekonAccessControl(_accessControl);
    }

    /**
     * @dev Issue a new credential attestation
     * @param recipient Address of the credential recipient
     * @param credentialHash Hash of the credential data
     * @param credentialTypeId Type ID of the credential
     * @param expiresAt Expiry timestamp (0 for never expires)
     * @param transferable Whether the credential can be transferred
     * @return attestationId The ID of the created attestation
     */
    function issueCredential(
        address recipient,
        bytes32 credentialHash,
        uint256 credentialTypeId,
        uint256 expiresAt,
        bool transferable
    ) external nonReentrant returns (bytes32) {
        require(
            accessControl.canIssueCredential(msg.sender),
            "Not authorized to issue credentials"
        );
        require(recipient != address(0), "Invalid recipient address");
        require(credentialHash != bytes32(0), "Invalid credential hash");
        
        if (expiresAt > 0) {
            require(expiresAt > block.timestamp, "Expiry must be in the future");
        }

        // Generate unique attestation ID
        bytes32 attestationId = keccak256(
            abi.encodePacked(
                msg.sender,
                recipient,
                credentialHash,
                credentialTypeId,
                block.timestamp,
                block.number
            )
        );

        require(!attestationExists[attestationId], "Attestation already exists");

        // Create attestation
        attestations[attestationId] = Attestation({
            id: attestationId,
            issuer: msg.sender,
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
        recipientCredentials[recipient].push(attestationId);
        issuerCredentials[msg.sender].push(attestationId);

        emit CredentialIssued(
            attestationId,
            msg.sender,
            recipient,
            credentialHash,
            block.timestamp,
            expiresAt
        );

        return attestationId;
    }

    /**
     * @dev Revoke a credential attestation
     * @param attestationId ID of the attestation to revoke
     * @param reason Reason for revocation
     */
    function revokeCredential(bytes32 attestationId, string calldata reason) // Changed to calldata
        external 
        nonReentrant 
    {
        require(attestationExists[attestationId], "Attestation does not exist");
        
        Attestation storage attestation = attestations[attestationId];
        require(attestation.issuer == msg.sender, "Only issuer can revoke");
        require(!attestation.isRevoked, "Already revoked");

        attestation.isRevoked = true;
        attestation.revocationReason = reason;
        attestation.revokedAt = block.timestamp;

        emit CredentialRevoked(attestationId, msg.sender, reason, block.timestamp);
    }

    /**
     * @dev Transfer a credential to a new recipient (only for transferable credentials)
     * @param attestationId ID of the attestation to transfer
     * @param newRecipient Address of the new recipient
     */
    function transferCredential(bytes32 attestationId, address newRecipient) 
        external 
        nonReentrant 
    {
        require(attestationExists[attestationId], "Attestation does not exist");
        require(newRecipient != address(0), "Invalid recipient address");
        
        Attestation storage attestation = attestations[attestationId];
        require(attestation.recipient == msg.sender, "Only current recipient can transfer");
        require(attestation.transferable, "Credential is not transferable");
        require(!attestation.isRevoked, "Cannot transfer revoked credential");
        
        if (attestation.expiresAt > 0) {
            require(block.timestamp < attestation.expiresAt, "Cannot transfer expired credential");
        }

        address oldRecipient = attestation.recipient;
        attestation.recipient = newRecipient;

        // Update recipient credentials mapping
        recipientCredentials[newRecipient].push(attestationId);

        emit CredentialTransferred(attestationId, oldRecipient, newRecipient);
    }

    /**
     * @dev Verify a credential attestation
     * @param attestationId ID of the attestation to verify
     * @return isValid Whether the credential is valid
     * @return issuer Address of the issuer
     * @return recipient Address of the recipient
     * @return issuedAt Issuance timestamp
     * @return expiresAt Expiry timestamp
     * @return isRevoked Whether the credential is revoked
     */
    function verifyCredential(bytes32 attestationId) 
        external 
        view 
        returns (
            bool isValid,
            address issuer,
            address recipient,
            uint256 issuedAt,
            uint256 expiresAt,
            bool isRevoked
        ) 
    {
        if (!attestationExists[attestationId]) {
            return (false, address(0), address(0), 0, 0, false);
        }

        Attestation memory attestation = attestations[attestationId];
        
        bool valid = !attestation.isRevoked;
        if (attestation.expiresAt > 0 && block.timestamp >= attestation.expiresAt) {
            valid = false;
        }

        return (
            valid,
            attestation.issuer,
            attestation.recipient,
            attestation.issuedAt,
            attestation.expiresAt,
            attestation.isRevoked
        );
    }

    /**
     * @dev Check if a credential is currently valid
     * @param attestationId ID of the attestation
     * @return bool True if valid
     */
    function isCredentialValid(bytes32 attestationId) external view returns (bool) {
        if (!attestationExists[attestationId]) {
            return false;
        }

        Attestation memory attestation = attestations[attestationId];
        
        if (attestation.isRevoked) {
            return false;
        }

        if (attestation.expiresAt > 0 && block.timestamp >= attestation.expiresAt) {
            return false;
        }

        return true;
    }

    /**
     * @dev Get all credentials for a recipient
     * @param recipient Address of the recipient
     * @return Array of attestation IDs
     */
    function getCredentialsByRecipient(address recipient) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        return recipientCredentials[recipient];
    }

    /**
     * @dev Get all credentials issued by an issuer
     * @param issuer Address of the issuer
     * @return Array of attestation IDs
     */
    function getCredentialsByIssuer(address issuer) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        return issuerCredentials[issuer];
    }

    /**
     * @dev Get attestation details
     * @param attestationId ID of the attestation
     * @return Attestation struct
     */
    function getAttestation(bytes32 attestationId) 
        external 
        view 
        returns (Attestation memory) 
    {
        require(attestationExists[attestationId], "Attestation does not exist");
        return attestations[attestationId];
    }

    /**
     * @dev Batch issue credentials to multiple recipients
     * @param recipients Array of recipient addresses
     * @param credentialHashes Array of credential hashes
     * @param credentialTypeId Type ID of the credentials
     * @param expiresAt Expiry timestamp (0 for never expires)
     * @param transferable Whether the credentials can be transferred
     * @return attestationIds Array of created attestation IDs
     */
    function batchIssueCredentials(
        address[] memory recipients,
        bytes32[] memory credentialHashes,
        uint256 credentialTypeId,
        uint256 expiresAt,
        bool transferable
    ) external nonReentrant returns (bytes32[] memory) {
        require(
            accessControl.canIssueCredential(msg.sender),
            "Not authorized to issue credentials"
        );
        require(recipients.length == credentialHashes.length, "Array length mismatch");
        require(recipients.length > 0, "Empty arrays");

        bytes32[] memory attestationIds = new bytes32[](recipients.length);

        for (uint256 i = 0; i < recipients.length;) {
            require(recipients[i] != address(0), "Invalid recipient address");
            require(credentialHashes[i] != bytes32(0), "Invalid credential hash");

            bytes32 attestationId = keccak256(
                abi.encodePacked(
                    msg.sender,
                    recipients[i],
                    credentialHashes[i],
                    credentialTypeId,
                    block.timestamp,
                    block.number,
                    i
                )
            );

            attestations[attestationId] = Attestation({
                id: attestationId,
                issuer: msg.sender,
                recipient: recipients[i],
                credentialHash: credentialHashes[i],
                credentialTypeId: credentialTypeId,
                issuedAt: block.timestamp,
                expiresAt: expiresAt,
                transferable: transferable,
                isRevoked: false,
                revocationReason: "",
                revokedAt: 0
            });

            attestationExists[attestationId] = true;
            recipientCredentials[recipients[i]].push(attestationId);
            issuerCredentials[msg.sender].push(attestationId);

            attestationIds[i] = attestationId;

            emit CredentialIssued(
                attestationId,
                msg.sender,
                recipients[i],
                credentialHashes[i],
                block.timestamp,
                expiresAt
            );
            
            unchecked {
                i++;
            }
        }

        return attestationIds;
    }

    /**
     * @dev Get credential count for a recipient
     * @param recipient Address of the recipient
     * @return count Number of credentials
     */
    function getRecipientCredentialCount(address recipient) 
        external 
        view 
        returns (uint256) 
    {
        return recipientCredentials[recipient].length;
    }

    /**
     * @dev Get credential count for an issuer
     * @param issuer Address of the issuer
     * @return count Number of credentials issued
     */
    function getIssuerCredentialCount(address issuer) 
        external 
        view 
        returns (uint256) 
    {
        return issuerCredentials[issuer].length;
    }
}
