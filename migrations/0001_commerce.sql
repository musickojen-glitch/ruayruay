PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS rr_products (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, price_satang INTEGER NOT NULL CHECK(price_satang > 0),
 original_key TEXT, original_sha256 TEXT, ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1))
);
CREATE TABLE IF NOT EXISTS rr_orders (
 id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, request_id TEXT NOT NULL,
 total_satang INTEGER NOT NULL CHECK(total_satang > 0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','review','paid','rejected','refunded')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, receipt_id TEXT, rejection_reason TEXT,
 is_test INTEGER NOT NULL DEFAULT 0 CHECK(is_test IN (0,1)),
 UNIQUE(owner_hash,request_id)
);
CREATE INDEX IF NOT EXISTS rr_orders_status ON rr_orders(status,created_at);
CREATE TABLE IF NOT EXISTS rr_order_items (
 order_id TEXT NOT NULL REFERENCES rr_orders(id), product_id TEXT NOT NULL,
 title TEXT NOT NULL, unit_price_satang INTEGER NOT NULL, original_key TEXT NOT NULL,
 PRIMARY KEY(order_id,product_id)
);
CREATE TABLE IF NOT EXISTS rr_receipts (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES rr_orders(id), object_key TEXT NOT NULL,
 sha256 TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rr_payments (
 order_id TEXT PRIMARY KEY REFERENCES rr_orders(id), receipt_id TEXT NOT NULL UNIQUE,
 transaction_ref TEXT NOT NULL UNIQUE, amount_satang INTEGER NOT NULL,
 transferred_at INTEGER NOT NULL, approved_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rr_download_tokens (
 token_hash TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES rr_orders(id), product_id TEXT NOT NULL,
 owner_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE TABLE IF NOT EXISTS rr_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO rr_settings(key,value) VALUES ('checkout_enabled','false');
INSERT OR IGNORE INTO rr_settings(key,value) VALUES ('payment_recipient','เจนณรงค์ วัชรสวัสดิ์');
CREATE TABLE IF NOT EXISTS rr_rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rr_audit (
 id TEXT PRIMARY KEY, action TEXT NOT NULL, order_id TEXT, detail TEXT NOT NULL, created_at INTEGER NOT NULL
);
