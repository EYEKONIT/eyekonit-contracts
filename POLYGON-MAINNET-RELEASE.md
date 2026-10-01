# Polygon PoS mainnet preparation

The unfinished Base changes have been reverted. Solidity contracts retain their
existing V2 behavior and the fixed treasury 0x497574ee15579f9f6836d472eac236f85be4478d.
Primary paid claims send 20% to that treasury and 80% to the identity creator.

## Deployment

- Network: Polygon PoS mainnet, chain 137; native gas currency POL.
- Use the existing authorized deployer/owner wallet. Keep its private key outside Git.
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
contract addresses. Set sync starting cursors from the deployment block numbers.
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
