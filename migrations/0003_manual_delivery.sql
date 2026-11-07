CREATE TABLE IF NOT EXISTS rr_contacts (
 order_id TEXT PRIMARY KEY REFERENCES rr_orders(id),
 method TEXT NOT NULL CHECK(method IN ('email','line')),
 value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rr_fulfillments (
 order_id TEXT PRIMARY KEY REFERENCES rr_orders(id),
 sent_at INTEGER NOT NULL,
 note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS rr_small_files (
 key TEXT PRIMARY KEY,
 mime TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes <= 921600),
 data BLOB NOT NULL
);
