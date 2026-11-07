CREATE TABLE IF NOT EXISTS rr_drive_deliveries (
 order_id TEXT NOT NULL REFERENCES rr_orders(id),
 product_id TEXT NOT NULL,
 url TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(order_id,product_id),
 FOREIGN KEY(order_id,product_id) REFERENCES rr_order_items(order_id,product_id)
);
