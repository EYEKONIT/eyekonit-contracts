# EYEKON Smart Contracts

Smart contracts for the EYEKON platform, built with Hardhat and deployed on Polygon.

## Overview

This directory contains the Solidity smart contracts that power the EYEKON platform:

- **AccessControl.sol**: Role-based access control for organizations and permissions
- **IdentityNFT.sol**: ERC-721 identity NFT management with multi-edition support
- **CredentialRegistry.sol**: On-chain credential attestations

## ✅ Implementation Status

### Completed Contracts

✅ **AccessControl Contract**
- Organization registration and management
- Role-based permissions (ADMIN, MINTER, ISSUER, ORG_OWNER, ORG_ADMIN, ORG_MEMBER)
- Team member management (add, remove, update roles)
- Permission checking functions

✅ **IdentityNFT Contract**
- ERC-721 token standard for identity NFTs
- Supply limits and pricing (free or paid in ETH)
- Evolution/timeline chapter requirements
- Holder discounts for timeline progression
- Invitation-based claiming
- Transfer tracking and holder management

✅ **CredentialRegistry Contract**
- On-chain attestation creation
- Credential issuance with expiry support
- Revocation capabilities
- Transfer support for transferable credentials
- Batch issuance functionality
- Verification functions

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Configure your `.env` file with:
   - Private key for deployment
   - RPC URLs for Mumbai testnet and Polygon mainnet
   - PolygonScan API key for contract verification

## Development

### Compile Contracts
```bash
npm run compile
```

### Run Tests
```bash
npm test
```

### Test Coverage
```bash
npm run test:coverage
```

### Gas Report
```bash
npm run test:gas
```

## Deployment

### Deploy to Mumbai Testnet
```bash
npm run deploy:mumbai
```

### Deploy to Polygon Mainnet
```bash
npm run deploy:polygon
```

### Verify Contracts
```bash
npm run verify:mumbai
# or
npm run verify:polygon
```

## Contract Addresses

After deployment, contract addresses will be saved to `deployments/` directory.

### Mumbai Testnet
- AccessControl: TBD
- IdentityNFT: TBD
- CredentialRegistry: TBD

### Polygon Mainnet
- AccessControl: TBD
- IdentityNFT: TBD
- CredentialRegistry: TBD

## Architecture

### AccessControl Contract
Manages roles and permissions:
- **ADMIN_ROLE**: Platform administrators
- **MINTER_ROLE**: Can mint identity NFTs
- **ISSUER_ROLE**: Can issue credentials
- **ORG_OWNER_ROLE**: Organization owners
- **ORG_ADMIN_ROLE**: Organization administrators
- **ORG_MEMBER_ROLE**: Organization members

**Key Functions:**
- `registerOrganization(name)`: Create a new organization
- `addOrganizationMember(orgId, member, role)`: Add team member
- `removeOrganizationMember(orgId, member)`: Remove team member
- `updateMemberRole(orgId, member, newRole)`: Update member role
- `canMintIdentity(account)`: Check minting permission
- `canIssueCredential(account)`: Check issuing permission

### IdentityNFT Contract
Manages identity NFTs with:
- Support for ERC-721 standard
- Supply limits and pricing
- Evolution/timeline chapter requirements
- Holder discounts for timeline progression

**Key Functions:**
- `createIdentity(metadataURI, maxSupply, price, ...)`: Create new identity
- `mintIdentity(to, identityId)`: Mint to specific address (admin)
- `claimIdentity(identityId, invitationHash)`: Claim/purchase identity
- `setPrice(identityId, newPrice)`: Update price
- `setSupplyLimit(identityId, limit)`: Update supply limit
- `canClaimChapter(user, chapterId)`: Check evolution eligibility
- `getHolders(identityId)`: Get all holders
- `balanceOfIdentity(owner, identityId)`: Get user's balance

### CredentialRegistry Contract
Manages credential attestations with:
- On-chain attestation creation
- Revocation capabilities
- Expiry tracking
- Transfer support for transferable credentials

**Key Functions:**
- `issueCredential(recipient, credentialHash, ...)`: Issue credential
- `revokeCredential(attestationId, reason)`: Revoke credential
- `transferCredential(attestationId, newRecipient)`: Transfer credential
- `verifyCredential(attestationId)`: Verify credential validity
- `isCredentialValid(attestationId)`: Check if valid
- `batchIssueCredentials(recipients, ...)`: Batch issuance
- `getCredentialsByRecipient(recipient)`: Get user's credentials
- `getCredentialsByIssuer(issuer)`: Get issued credentials

## Features

### Identity NFTs
- **Multi-edition support**: Create identities with supply limits
- **Pricing**: Free or paid identities in ETH
- **Evolution/Timeline**: Sequential chapter requirements
- **Holder discounts**: Discounts for timeline holders
- **Invitation system**: Invite-only claiming with unique tokens
- **Transfer tracking**: Automatic holder management

### Credentials
- **On-chain attestations**: Immutable credential records
- **Expiry support**: Never expires, fixed date, or duration-based
- **Revocation**: Issuer can revoke with reason
- **Transferability**: Optional transfer support
- **Batch issuance**: Issue multiple credentials at once
- **Verification**: On-chain verification of validity

### Access Control
- **Organization management**: Multi-organization support
- **Role-based permissions**: Granular access control
- **Team management**: Add/remove members with roles
- **Permission checks**: Verify minting and issuing rights

## Security

- All contracts use OpenZeppelin's audited libraries
- Access control implemented for all sensitive functions
- ReentrancyGuard protection on state-changing functions
- Comprehensive input validation
- Contracts should be audited before mainnet deployment

## Gas Optimization

- Efficient storage patterns
- Batch operations where possible
- Minimal on-chain storage
- Event emission for off-chain indexing

## Next Steps

1. ✅ Smart contracts implemented
2. ⏳ Write comprehensive tests
3. ⏳ Deploy to Mumbai testnet
4. ⏳ Integrate with backend API
5. ⏳ Security audit
6. ⏳ Deploy to Polygon mainnet

## License

MIT
