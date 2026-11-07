# RUAYRUAY — payment implementation status (2026-11-08)

## Implemented
Server-backed manual-payment flow, customer order page, authenticated admin review, private receipt/original uploads, server-authoritative 9 THB pricing, D1 idempotency and unique bank transaction reference, and owner-bound one-use downloads. Preserves established storefront and 46 real previews. Old simulated slip approval removed.

## Verified locally
13 automated integration scenarios passed using actual SQL through SQLite and an in-memory R2 adapter. Includes server price, order retry, CSRF, unauthorized access, receipt/transaction duplication, pending approval, invalid amount/recipient/bank confirmation, stale receipt, private downloads, single-use/expiry/refund revocation, authentication rate limit, original snapshot, closed public checkout with private owner test, size limits and invalid requests. All JS syntax checks passed.

These tests do not prove production D1/R2/QR/bank readiness. No real money was transferred during testing. No customer data or banking credentials used.

## Release gates
- Cloudflare sign-in is needed to create/bind DB and private FILES storage, run migrations and configure secrets.
- Import the owner's QR and all 46 originals through admin. Do not commit these originals to the public repository.
- Verify browser/mobile layout and production integration, recipient scan and actual manual bank confirmation/download.
- LIVE_CHECKOUT_ENABLED remains false/unset and persisted checkout_enabled=false until owner test passes. Owner-only test mode requires both an admin session and a separate 30-minute test cookie; it does not open public checkout.
- Existing product cultural citation review remains pending.

See PAYMENT_SETUP_TH.md for exact setup and limitations. Use migrations/ for D1; legacy schema.sql is PostgreSQL and is not the active schema.
