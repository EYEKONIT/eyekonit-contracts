# Polygon timeline upgrade

Status: prepared and tested locally; not deployed or activated.

TimelineV3 preserves the TimelineV2 ABI used by the site. It fixes incoming NFT
holders being rejected by the history-only previous-chapter requirement, makes
repeat edition claims idempotent for progress, prevents published timeline edits,
and enforces chapter plan/dependency limits. IdentityNFT and its 80/20 payment splitter remain intact.
The deployed TimelineV2 source is preserved unchanged for release verification.

`npx hardhat run scripts/prepare-timeline-upgrade.ts --network polygon` performs
read-only checks and creates `deployments/polygon-timeline-v3-plan.json` with
unsigned owner transactions. It does not sign or broadcast. Regenerate this plan
immediately before deployment: the predicted address depends on the owner nonce,
and any new timelines or claims change migration preconditions.

The plan deploys TimelineV3, configures the existing NFT address, imports legacy
timelines sequentially, routes NFT callbacks to the replacement to freeze claims,
imports all legacy user progress, then finalizes the migration. Imports preserve
timeline IDs, creators, metadata, timestamps, chapter links and completion history.
Finalization rejects changed metadata, missing users or altered timeline counts.
Do not bypass those checks or silently reset existing holdings/progress.

Activation requires:

1. Validate the signing host remediation before using the local deployment key,
   or sign on a clean device. The earlier flagged download still existed when
   checked on October 3; no local-key signing was performed for this upgrade.
2. Enable the existing blockchain maintenance guard and recheck all legacy
   state. Keep the website, authentication and auction configuration unchanged.
3. Sign the reviewed owner transactions on Polygon 137. Check each receipt,
   deployed bytecode/constructor and migrated metadata/chapters before routing
   IdentityNFT's reference. Claims remain disabled by the migration guard until
   all legacy progress is imported and finalized. Confirm the existing owner and
   platform treasury are unchanged. A failure here requires completing or rolling
   back the reviewed cutover; never disable website maintenance prematurely.
4. Update Railway TIMELINE_ADDRESS and Vercel VITE_TIMELINE_ADDRESS together.
   Keep every other mainnet address and the original sync start block. Wait for
   both production deployments and their network handshake to agree.
5. Verify the new timeline sync cursor and receipts, then remove maintenance.
   Exercise all live timeline and evolution cases in the acceptance ledger.

An earlier October 3 read-only plan found two legacy timelines, zero timeline
holders, 15.68 POL in the approved owner wallet, and a conservative six-transaction
gas budget of 2.54 POL. Live testing has since created a timeline holder, so that
plan is stale and progress imports must be regenerated. The owner is
0x988d0D4f9E58913440B52B2dAa0c472E7CB7f64D. No additional funding is needed based
on that snapshot; recalculate before signing.

The platform API and UI now reject edits to published evolution records and
their content. The existing IdentityNFTV2 still exposes metadata, price and
supply setters to its authorized creator. TimelineV3 alone cannot enforce
immutability of those NFT fields; that separate protocol change remains open.
