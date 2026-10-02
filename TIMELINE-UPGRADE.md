# Polygon timeline upgrade

Status: prepared and tested locally; not deployed or activated.

TimelineV3 preserves the TimelineV2 ABI used by the site. It fixes incoming NFT
holders being rejected by the history-only previous-chapter requirement, makes
repeat edition claims idempotent for progress, and enforces archive and chapter
plan/dependency limits. IdentityNFT and its 80/20 payment splitter remain intact.
The deployed TimelineV2 source is preserved unchanged for release verification.

`npx hardhat run scripts/prepare-timeline-upgrade.ts --network polygon` performs
read-only checks and creates `deployments/polygon-timeline-v3-plan.json` with
unsigned owner transactions. It does not sign or broadcast. Regenerate this plan
immediately before deployment: the predicted address depends on the owner nonce,
and any new timelines or claims change migration preconditions.

The plan deploys TimelineV3, configures the existing NFT address, imports legacy
timelines sequentially, and updates IdentityNFT's timeline reference. Imports
preserve original timeline IDs, creators, metadata, timestamps and chapter links.
They explicitly reject timelines with completion history; do not bypass that
check or silently reset existing holdings/progress.

Activation requires:

1. Validate the signing host remediation before using the local deployment key,
   or sign on a clean device. The earlier flagged download still existed when
   checked on October 3; no local-key signing was performed for this upgrade.
2. Enable the existing blockchain maintenance guard and recheck all legacy
   state. Keep the website, authentication and auction configuration unchanged.
3. Sign the reviewed owner transactions on Polygon 137. Check each receipt,
   deployed bytecode/constructor and migrated metadata/chapters before updating
   IdentityNFT's reference. Confirm its owner and platform treasury are unchanged.
4. Update Railway TIMELINE_ADDRESS and Vercel VITE_TIMELINE_ADDRESS together.
   Keep every other mainnet address and the original sync start block. Wait for
   both production deployments and their network handshake to agree.
5. Verify the new timeline sync cursor and receipts, then remove maintenance.
   Exercise all live timeline and evolution cases in the acceptance ledger.

The October 3 read-only plan found one legacy timeline, zero timeline holders,
15.68 POL in the approved owner wallet, and a conservative four-transaction gas
budget of 2.22 POL. These values are a snapshot, not a fixed quote. The owner is
0x988d0D4f9E58913440B52B2dAa0c472E7CB7f64D. No additional funding is needed based
on that snapshot.
