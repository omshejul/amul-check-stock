const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'stock-checker.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    delivery_pincode TEXT NOT NULL,
    interval_minutes INTEGER NOT NULL DEFAULT 5,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(url, delivery_pincode, interval_minutes)
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'active',
    status_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, email),
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
`);

const subscriptionColumns = db.prepare('PRAGMA table_info(subscriptions)').all();

if (!subscriptionColumns.some((column) => column.name === 'email')) {
  db.exec('ALTER TABLE subscriptions ADD COLUMN email TEXT');
  db.exec('UPDATE subscriptions SET email = "" WHERE email IS NULL');
}

if (!subscriptionColumns.some((column) => column.name === 'phone_number')) {
  db.exec('ALTER TABLE subscriptions ADD COLUMN phone_number TEXT');
}

if (!subscriptionColumns.some((column) => column.name === 'status')) {
  db.exec("ALTER TABLE subscriptions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  db.exec("UPDATE subscriptions SET status = 'active' WHERE status IS NULL");
}

if (!subscriptionColumns.some((column) => column.name === 'status_changed_at')) {
  db.exec('ALTER TABLE subscriptions ADD COLUMN status_changed_at TEXT');
  db.exec('UPDATE subscriptions SET status_changed_at = created_at WHERE status_changed_at IS NULL');
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_product_email
  ON subscriptions(product_id, email);
`);

module.exports = db;

