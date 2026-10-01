# Polygon PoS mainnet preparation

## Deployed release (October 2, 2026 PKT)

The five V2 contracts were deployed on Polygon PoS mainnet (137) using the new
approved wallet. All five contract sources passed Polygonscan verification.
`npm run check:polygon` also checked transaction status, deployment bytecode,
constructor arguments, runtime code, admin roles, ownership, contract links,
the 20% fee and client treasury. The compromised legacy wallet has no admin role.

| Contract | Mainnet address |
| --- | --- |
| AccessControl | 0x95EB5Cc874a84B966Caed1e39d4056fd2fEbd0ae |
| IdentityNFT | 0x58942b4cCdC317608C4Fb6A76F9104b8f209247b |
| Timeline | 0x8aBfa40aA501Dd6138b4b1513c5be7637690AE8A |
| CredentialRegistry | 0xf9B0BCCCCB2C6f61B84835f6fAfA10FfF03126e4 |
| PaymentSplitter | 0xfc44fCb1C7c4A0Cca5Ee76da6B2d06a019fc4474 |

Deployment and setup spent 3.685066336052795588 POL; the checked remaining wallet
balance was 11.064933663947204412 POL. The authoritative receipt manifest is
`deployments/polygon-v2.2.json`; the read-only check report is the adjacent
`.checks.json` file. These are deployment checks, not proof of complete product
readiness or an independent smart-contract security audit.

The unfinished Base changes have been reverted. Solidity contracts retain their
existing V2 behavior and the fixed treasury 0x497574ee15579f9f6836d472eac236f85be4478d.
Primary paid claims send 20% to that treasury and 80% to the identity creator.

## Deployment

- Network: Polygon PoS mainnet, chain 137; native gas currency POL.
- Approved deployer/owner: 0x988d0D4f9E58913440B52B2dAa0c472E7CB7f64D. Set EXPECTED_DEPLOYER_ADDRESS to this address. Keep its private key outside Git and chat.
- The old 0xE6dfCDfec1C431d77c046D3D2a3CEdcE27407541 wallet is compromised and blocked from deployment.
- Set POLYGON_RPC_URL to a mainnet RPC and PLATFORM_ADMIN_ADDRESS to the approved owner.
- Run `npm test` before signing deployment transactions.
- Set CONFIRM_POLYGON_MAINNET=137 only for an approved deployment.
- Run `npm run deploy:polygon:v2`. The legacy V1 mainnet scripts are disabled.
- The deployment verifies chain ID, treasury, fee, and the three cross-contract links.
- Its final manifest is deployments/polygon-v2.2.json; never overwrite a previous deployment.
- Verify every contract source and constructor arguments on Polygonscan before cutover.

## Application cutover

The live application remains on Amoy until contracts and data migration are ready.

Backend: set BLOCKCHAIN_CHAIN_ID=137, mainnet POLYGON_RPC_URL, and all five new
contract addresses. Set BLOCKCHAIN_SYNC_START_BLOCK=94789009 (the earliest
deployment block, inclusive). Saved cursors must be preserved across restarts.
Frontend: set VITE_CHAIN_ID=137, VITE_CHAIN_NAME=Polygon Mainnet, a browser-safe
VITE_BROWSER_RPC_URL, VITE_USE_CUSTOM_CONTRACT_ADDRESSES=true, and all five new
VITE_*_ADDRESS variables. Mainnet builds fail closed if these addresses are missing.

Keep testnet chain records separate from mainnet records; on-chain numeric IDs
restart on new contracts. Preserve user accounts, paid memberships and Stripe
history. Existing Amoy NFTs and invitation signatures do not migrate automatically.
Review native-token prices before enabling real-money claims.

Before public launch, rehearse claims, transfers, invitations, credentials,
organization roles and timeline progression, including failed and canceled
transactions. The prior launch audit's non-network findings remain a release
checklist; network preparation alone does not resolve all product/security gaps.
