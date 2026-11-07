# RUAYRUAY payment API — implemented, setup gated

The Pages Function `functions/api/[[path]].js` implements these routes. Runtime bindings: private R2 `FILES`, D1 `DB`, secrets `ADMIN_SECRET`, `SESSION_SECRET`, and explicit gate `LIVE_CHECKOUT_ENABLED`. The persisted `checkout_enabled` flag also must be true. Both gates default closed. No secret or full-resolution original is committed.

Customer:
- GET /api/config — public checkout availability; no QR before enabled
- POST /api/orders — productIds and requestId; server-calculated price and idempotent durable order
- GET /api/orders/:id — requires owning signed guest cookie
- GET /api/orders/:id/qr — private QR, authenticated order, live and unexpired unpaid order only
- POST /api/orders/:id/receipt — raw JPG/PNG <=5 MB; status changes to review only
- POST /api/orders/:id/downloads — productId; paid order issues 5-minute, one-use link
- GET /api/downloads/:token — requires matching owning guest cookie; atomic consume; paid status rechecked

Admin (signed HttpOnly 8-hour cookie after password login):
- POST /api/admin/login, POST /api/admin/logout
- GET /api/admin/status
- GET /api/admin/orders?status=review (bounded to 100; other documented statuses supported)
- GET /api/admin/orders/:id, GET /api/admin/orders/:id/receipt
- POST /api/admin/orders/:id/approve — current receiptId, bankConfirmed, recipientConfirmed, amountSatang, transferredAt, transactionRef; durable unique bank reference and atomic approval
- POST /api/admin/orders/:id/reject — current receiptId and reason
- POST /api/admin/orders/:id/refund — records an already-completed external refund and revokes downloads; does not move money
- PUT /api/admin/products/:id/original — private JPG 2160×3840, maximum 20 MB
- PUT /api/admin/payment-qr — private JPG/PNG <=3 MB; GET same path previews for admin
- POST /api/admin/settings — explicit enable/disable; enabling requires deployment gate and owner's QR/fulfillment confirmations

Mutations require exact Origin match. Cookies: Secure, HttpOnly, SameSite=Strict, __Host prefix. API responses are private/no-store, nosniff, no-referrer. No CORS is enabled. Rate limiting uses hashed IP/window keys. Customer-visible data excludes receipt keys, original keys and secrets. Original snapshots preserve already-purchased files. Payment-receipt images never auto-approve an order.

See PAYMENT_SETUP_TH.md for configuration, release gates and limits. Full integration and actual bank confirmation remain required before live checkout.
