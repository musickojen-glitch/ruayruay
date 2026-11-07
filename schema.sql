-- RUAYRUAY catalog and order schema for a server-side database (PostgreSQL)
CREATE TABLE IF NOT EXISTS products (
 id text PRIMARY KEY,
 title text NOT NULL,
 category text NOT NULL,
 hook text NOT NULL DEFAULT '',
 description text NOT NULL DEFAULT '',
 cultural_meaning text NOT NULL DEFAULT '',
 citation_url text,
 preview_path text,
 private_original_key text,
 price_satang integer NOT NULL DEFAULT 900 CHECK(price_satang > 0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','archived')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
 id uuid PRIMARY KEY,
 total_satang integer NOT NULL CHECK(total_satang > 0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','review','paid','rejected','fulfilled','refunded')),
 payment_reference text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_items (
 order_id uuid NOT NULL REFERENCES orders(id),
 product_id text NOT NULL REFERENCES products(id),
 unit_price_satang integer NOT NULL,
 PRIMARY KEY(order_id,product_id)
);
CREATE TABLE IF NOT EXISTS delivery_tokens (
 token_hash text PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES orders(id),
 product_id text NOT NULL REFERENCES products(id),
 expires_at timestamptz NOT NULL,
 used_at timestamptz
);
-- Never store bank credentials, secret keys or unwatermarked originals in a public repository.
