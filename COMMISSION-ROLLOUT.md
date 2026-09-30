# EYEKONIT claim commission

Paid identity claims, including paid evolution timeline chapters and invitation claims, send 80% to the identity's on-chain creator and 20% to `0x497574ee15579f9f6836d472eac236f85be4478d`. The platform amount is floor(gross wei / 5); the creator receives the remainder. Both payouts happen atomically with the claim. Gas fees, NFT transfers, identity creation, free claims and optional secondary royalty distributions are separate from the purchase price.

## Existing Amoy identities

The currently configured identity is `0xE0BE5161c82EB5bef9FEf537B8195C3747fad873` on Polygon Amoy (80002). Contracts are not proxies. Editing Solidity does not change deployed behavior.

The replacement `PaymentSplitterV2` supports the already deployed identity's `isRoyaltyConfigured` gate for every existing identity. Attach the replacement with `setPaymentSplitter`; no identity migration or remint is needed. Optional secondary royalty setup has a separate `isSecondaryRoyaltyConfigured` getter. Primary payouts cannot be redirected by secondary recipient configuration.

## Activation sequence

1. Run all three repository test/build suites and synchronize the splitter ABI files.
2. Set `COMMISSION_IDENTITY_ADDRESS` to the verified active identity address, then run `npx hardhat run scripts/deploy-commission-splitter.ts --network amoy`. By default this only reads configuration and estimates deployment gas.
3. After approval, set `DEPLOY_COMMISSION_SPLITTER=true` and run the same command to deploy the splitter. The deployment manifest contains the previous address, new address, owner, deployment hash and unsigned activation calldata. This script never activates it.
4. Verify deployed bytecode, `identityContract`, `PLATFORM_WALLET` and `PLATFORM_FEE_BPS`. The actual identity owner or its Safe must submit the manifest's `setPaymentSplitter` activation transaction. Verify the receipt and identity's `paymentSplitter()` afterward.
5. Update backend `PAYMENT_SPLITTER_ADDRESS` and frontend's configured splitter address together. The frontend has hardcoded default Amoy addresses; replace its splitter default in `src/config/contracts.ts`, or set `VITE_USE_CUSTOM_CONTRACT_ADDRESSES=true` plus all intended address overrides. Preserve the other active addresses. Deploy backend and frontend with the synchronized ABIs. The frontend refuses paid claims when the attached splitter cannot prove the intended wallet and fee.
6. Make a small Amoy purchase from a second wallet. Verify the creator and platform balance deltas, `PrimarySaleSettled`, `IdentityClaimed`, the backend record and `/admin/transactions`. Verify a free claim, a discounted chapter and an invitation claim. Testnet currency has no production settlement value.
7. Use the existing historical blockchain sync to recover missing claim records. Records with no settlement snapshot can be verified with the admin detail action. Old purchases without the new settlement event remain explicitly unverified; do not retroactively declare them 80/20 paid.

Keep the previous splitter address and ABI available: old pending secondary royalties remain in that contract and must be withdrawn from that original address. They do not move to the replacement. The replacement captures the previous splitter address at deployment and reads its secondary royalty configurations until a creator explicitly updates them. Do not remove legacy withdrawal access or abandon funds during cutover. The new primary-sale revenue is paid directly and is not a pending withdrawal.

## Activated deployment

On September 30, 2026, splitter `0x2894Aa62dC362edd59D3Da77914d794A0554b92b` was deployed and activated on the existing Amoy identity contract. Activation transaction: `0xadbdc8746b84b1202ec7569994d9a8ce8faf24d57148849fb9e997c37d47c074` (block 48909728). Runtime bytecode, fixed treasury address, 2000 basis-point commission, nine existing identities and the existing secondary royalty configuration were verified. The old splitter had no pending withdrawals at cutover.

No deployment, activation, production payout or live admin verification is implied by local test success. Mainnet activation requires its own verified identity address and deployment/configuration plan.
