# Polygon evolution release

Status: replacement contracts deployed on Polygon 137; holder imports and final
activation are in progress. Do not describe the live acceptance work as complete.

- IdentityNFTV3: `0xdfEb1cbAAf0FDf4b909A5A12F03Db03b5F18eF15`
- PaymentSplitterV2: `0x19715398AA552a345C1800d1f9dA0C133508A5d7`
- TimelineV4: `0xb50Ff5ADa4eCD813607232881EA6f23De55E6e97`

TimelineV4 adds personal journeys with organization ID zero while retaining
organization authorization and creator-only chapter attachment. The earlier
staged TimelineV3 at `0x08C96b14d6794E066f7fF469a5cB93caf3301f74` is superseded.
The original NFT import/recovery round trip was exercised through the live UI.
All six holdings and thirteen confirmed ledger records were compared with the
pre-upgrade baseline. Two edition ordinals were corrected against their original
mint events; ownership and historical payment amounts were preserved.

The release adds creator-signed, wallet-bound private evolution claims, freezes
published evolution definitions and timeline information, validates chapter
dependencies, and preserves sequential access for transferred NFT holders.
Repeated editions retain one historical completion per chapter. A transferred
prerequisite can complete the journey when the recipient claims the final chapter.
Primary sale payments retain the existing 80/20 client treasury policy.

Existing NFT definitions, token IDs, creators, supply, metadata URIs and timeline
progress are preserved. Each holder transfers their original NFT into the new
registry, which atomically mints the replacement with the same ID. Originals stay
escrowed after finalization so there is no transferable duplicate. Holders can
recover their originals before finalization. This recovery and interrupted-cutover
path must be supported and verified before activation.

`prepare-evolution-upgrade.ts` performs read-only checks and prepares a gas budget
and expected addresses. Regenerate its plan after any owner nonce, fee, definition,
timeline or holding changes. It rejects incomplete enumeration of historical
timeline participants instead of discarding progress.

`deploy-evolution-upgrade.ts` requires an explicit execution flag, Polygon 137,
the approved owner signer, matching bytecode, sufficient funding and verified
platform maintenance. It logs confirmed transaction hashes after every step and
can resume a partially prepared deployment. It stops before holder transfers and
finalization; no website address cutover is performed by that script.

Before activation, finish and verify:

1. The holder transfer and recovery UI/relay path, including interruption recovery.
2. Original NFT escrow and replacement ownership for every token.
3. Both migration finalizations and preservation of metadata and progress.
4. Historical sale receipts, payouts, ownership records and legacy splitter funds.
5. Matching Railway/Vercel addresses and protocol version, followed by deployment
   handshake checks before removing maintenance.
6. Fresh creator signatures for any unredeemed invitations from the old NFT domain.
7. Live public/private, free/paid, discount, invitation, transfer and content cases
   across members, creators and the read-only admin timeline panel.

The approved owner is `0x988d0D4f9E58913440B52B2dAa0c472E7CB7f64D`.
The client treasury remains `0x497574ee15579f9f6836d472eac236f85be4478d`.
The earlier flagged download was manually deleted and a completed Defender scan
verified no new active detection; the specific local-signing hold was resolved.
