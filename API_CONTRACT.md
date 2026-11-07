# RUAYRUAY — API contract (implementation pending)
This document defines the production backend interface; endpoints are NOT implemented by this file.
## Catalog
GET /api/products?cursor=...&category=... returns only status=ready products, paginated. No private_original_key is returned.
POST /api/admin/products requires server-verified admin authorization and accepts title, category, hook, description, citations, preview upload and private original upload. Default status=draft.
PATCH /api/admin/products/:id allows publishing only after asset, copyright and citation review.
## Orders
POST /api/orders accepts product IDs; server calculates authoritative price (9 THB each by default), persists pending order, and returns order ID and amount.
POST /api/orders/:id/payment-evidence accepts a receipt for manual review; it MUST NOT set paid automatically.
POST /api/admin/orders/:id/approve requires admin authentication and an independent verification of incoming bank funds, amount, recipient and duplicate transaction reference.
GET /api/orders/:id/downloads requires authenticated order ownership or a securely signed one-time token; only paid orders receive expiring private file links.
## Security and release gates
Use private object storage for originals, watermarked compressed previews in public storage, server-side authentication, rate limits, payment idempotency, audit logs, and signed time-limited download URLs. Never trust browser payment status or a screenshot alone. Do not enable real QR checkout or automatic fulfillment until integration tests pass.
