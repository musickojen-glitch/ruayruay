# RUAYRUAY — manual fulfillment QA 2026-11-08

Owner chose to send files manually after R2 signup requested a card. Default DELIVERY_MODE is manual. No R2/FILES binding required; originals stay in Drive.

Implemented: private required email/LINE ID, server price and idempotent order, private small QR/receipt files in D1, browser image resize, existing bank review and duplicate reference protection, payment and delivery statuses, explicit owner sent confirmation. Manual orders never issue automatic download links. No outbound messages are sent.

15 integration tests use real SQL in SQLite plus mock R2 for the legacy automatic path. Covers price, retry, authorization, CSRF, duplicate receipts/references, stale evidence, expiry/refund, login rate limit, no-R2 D1 file readback, private contact, valid email/LINE, paid-before-fulfill, explicit sent confirmation and manual download rejection. All JS syntax checks pass. These are local tests, not confirmation of production bank integration.

User screenshots confirm D1 ruayruay-orders created, initial schema executed, product_count=46 and DB binding saved in Production. R2 not activated. Add migration 0003, two secrets, and QR before owner-only testing. Keep LIVE_CHECKOUT_ENABLED false/unset and checkout_enabled=false until integration and actual owner bank verification/file sending are tested. Product cultural citation review remains pending.
