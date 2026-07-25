diff --git a/config/database.js b/config/database.js
index 8b4e8cecbd5f91d6fc7de49c01139f0595c8ae51..d95ad9ad934e01a6fed248276aa32bbd070abaaa 100644
--- a/config/database.js
+++ b/config/database.js
@@ -1,73 +1,129 @@
 /**
  * Inisialisasi database SQLite untuk billing RTRWnet
  */
 const Database = require('better-sqlite3');
 const path = require('path');
 const fs = require('fs');
 
 const dbDir = path.join(__dirname, '../database');
 if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
 
 const dbPath = path.join(dbDir, 'billing.db');
 
 let db;
 try {
   db = new Database(dbPath);
   db.pragma('journal_mode = WAL');
+  db.pragma('synchronous = NORMAL');
+  db.pragma('busy_timeout = 5000');
   db.pragma('foreign_keys = ON');
 
   // Menambahkan fungsi waktu lokal untuk SQLite sesuai setting timezone
   db.function('NOW_LOCAL', () => {
     const { getSetting } = require('./settingsManager');
     const tz = getSetting('timezone', 'Asia/Jakarta');
     const now = new Date();
     
     // Format: YYYY-MM-DD HH:mm:ss
     const options = {
       timeZone: tz,
       year: 'numeric',
       month: '2-digit',
       day: '2-digit',
       hour: '2-digit',
       minute: '2-digit',
       second: '2-digit',
       hour12: false
     };
     
     const formatter = new Intl.DateTimeFormat('en-US', options);
     const parts = formatter.formatToParts(now);
     const p = {};
     parts.forEach(part => p[part.type] = part.value);
     
     return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
   });
 } catch (err) {
   console.error('[DB] Gagal membuka database:', err.message);
   process.exit(1);
 }
 
+
+function tableExists(tableName) {
+  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
+  return Boolean(row);
+}
+
+function columnExists(tableName, columnName) {
+  if (!tableExists(tableName)) return false;
+  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((col) => col.name === columnName);
+}
+
+function addColumnIfMissing(tableName, columnName, columnDefinition) {
+  try {
+    if (!columnExists(tableName, columnName)) {
+      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
+      console.log(`[DB] Migrated ${tableName}.${columnName}`);
+    }
+  } catch (e) {
+    console.error(`[DB] Failed migrating ${tableName}.${columnName}: ${e.message}`);
+    throw e;
+  }
+}
+
+function createStartupBackupIfNeeded() {
+  if (process.env.DB_STARTUP_BACKUP === '0') return;
+  if (!fs.existsSync(dbPath)) return;
+
+  const backupDir = path.join(dbDir, 'backups');
+  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
+
+  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
+  const backupPath = path.join(backupDir, `billing.pre-migration.${stamp}.db`);
+  try {
+    db.pragma('wal_checkpoint(RESTART)');
+    fs.copyFileSync(dbPath, backupPath);
+    console.log(`[DB] Pre-migration backup created: ${backupPath}`);
+  } catch (e) {
+    console.error(`[DB] Failed to create pre-migration backup: ${e.message}`);
+    throw e;
+  }
+}
+
+function runMigration(name, fn) {
+  const tx = db.transaction(() => fn());
+  try {
+    tx();
+  } catch (e) {
+    console.error(`[DB] Migration failed (${name}): ${e.message}`);
+    throw e;
+  }
+}
+
+createStartupBackupIfNeeded();
+
 db.exec(`
   CREATE TABLE IF NOT EXISTS expense_categories (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE,
     parent_id INTEGER REFERENCES expense_categories(id),
     description TEXT,
     icon TEXT DEFAULT 'bi bi-tag',
     color TEXT DEFAULT '#6366f1',
     is_active INTEGER DEFAULT 1,
     created_at DATETIME DEFAULT (NOW_LOCAL())
   );
 
   CREATE TABLE IF NOT EXISTS expenses (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     date DATE NOT NULL,
     category TEXT NOT NULL,
     subcategory TEXT,
     amount INTEGER NOT NULL,
     description TEXT NOT NULL,
     vendor TEXT,
     receipt_number TEXT,
     payment_method TEXT DEFAULT 'cash',
     recorded_by_role TEXT,
     recorded_by_name TEXT,
     created_at DATETIME DEFAULT (NOW_LOCAL())
@@ -579,197 +635,185 @@ function forceUnlockCoreMenus() {
         states[menu] = 'visible';
         changed = true;
       }
       // Pastikan ada kunci aktivasi yang valid agar kode lama tetap membukanya
       const validKey = sha256(menu + passwordHash);
       if (keys[menu] !== validKey) {
         keys[menu] = validKey;
         changed = true;
       }
     }
 
     if (changed) {
       const now = new Date().toISOString();
       db.prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run(SETTINGS_KEY, JSON.stringify(states), now);
       db.prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run(KEYS_KEY, JSON.stringify(keys), now);
       console.log('[DB] Core menus have been force-unlocked.');
     }
   } catch (e) {
     console.error('[DB] Gagal force unlock core menus:', e.message);
   }
 }
 
 // Jalankan force unlock setiap kali database diinisialisasi
 forceUnlockCoreMenus();
 
-// Tambahkan kolom baru jika belum ada
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN auto_isolate INTEGER DEFAULT 1");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN isolate_day INTEGER DEFAULT 10");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN email TEXT DEFAULT ''");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN router_id INTEGER REFERENCES routers(id) ON DELETE SET NULL");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN olt_id INTEGER REFERENCES olts(id) ON DELETE SET NULL");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN pon_port TEXT DEFAULT ''");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN odp_id INTEGER REFERENCES odps(id) ON DELETE SET NULL");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN lat TEXT");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN lng TEXT");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN cable_path TEXT");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN connection_type TEXT DEFAULT 'pppoe'");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN static_ip TEXT");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN mac_address TEXT");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN hotspot_username TEXT DEFAULT ''");
-} catch (e) {}
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN hotspot_password TEXT DEFAULT ''");
-} catch (e) {}
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN hotspot_profile TEXT DEFAULT ''");
-} catch (e) {}
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN pppoe_password TEXT DEFAULT ''");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN pppoe_remote_address TEXT DEFAULT ''");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN wifi_ssid TEXT DEFAULT ''");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE customers ADD COLUMN collector_id INTEGER REFERENCES collectors(id) ON DELETE SET NULL");
-} catch (e) { /* ignore if already exists */ }
-try {
-  db.exec("ALTER TABLE collectors ADD COLUMN auto_approve INTEGER DEFAULT 0");
-} catch (e) { /* ignore if already exists */ }
-try { db.exec("ALTER TABLE odps ADD COLUMN port_capacity INTEGER NOT NULL DEFAULT 16"); } catch (e) { /* ignore if already exists */ }
-
-// Kolom untuk PPN & ULO/USO pada tabel packages
-try { db.exec("ALTER TABLE packages ADD COLUMN use_ppn INTEGER DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN ppn_percentage REAL DEFAULT 11.0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN use_uso INTEGER DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN uso_percentage REAL DEFAULT 1.75"); } catch (e) {}
-
-// Kolom untuk Tiket Bantuan (Foto & Catatan Teknisi)
-try { db.exec("ALTER TABLE tickets ADD COLUMN technician_notes TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE tickets ADD COLUMN photos TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE tickets ADD COLUMN photo_metadata TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE tickets ADD COLUMN customer_photos TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE tickets ADD COLUMN customer_photo_metadata TEXT DEFAULT ''"); } catch (e) {}
-
-// Kolom untuk Payment Gateway di tabel invoices
-try { db.exec("ALTER TABLE invoices ADD COLUMN payment_gateway TEXT"); } catch (e) {}
-try { db.exec("ALTER TABLE invoices ADD COLUMN payment_order_id TEXT"); } catch (e) {}
-try { db.exec("ALTER TABLE invoices ADD COLUMN payment_link TEXT"); } catch (e) {}
-try { db.exec("ALTER TABLE invoices ADD COLUMN payment_reference TEXT"); } catch (e) {}
-try { db.exec("ALTER TABLE invoices ADD COLUMN payment_payload TEXT"); } catch (e) {}
-try { db.exec("ALTER TABLE invoices ADD COLUMN payment_expires_at DATETIME"); } catch (e) {}
-
-// Kolom untuk QRIS statis (semi-otomatis via nominal unik)
-try { db.exec("ALTER TABLE invoices ADD COLUMN qris_unique_code INTEGER"); } catch (e) {}
-try { db.exec("ALTER TABLE invoices ADD COLUMN qris_amount_unique INTEGER"); } catch (e) {}
-try { db.exec("ALTER TABLE invoices ADD COLUMN qris_assigned_at DATETIME"); } catch (e) {}
-try { db.exec("ALTER TABLE invoices ADD COLUMN qris_paid_notif_id INTEGER"); } catch (e) {}
-
-// Kolom untuk QRIS statis pada voucher publik
-try { db.exec("ALTER TABLE public_voucher_orders ADD COLUMN qris_unique_code INTEGER"); } catch (e) {}
-try { db.exec("ALTER TABLE public_voucher_orders ADD COLUMN qris_amount_unique INTEGER"); } catch (e) {}
-try { db.exec("ALTER TABLE public_voucher_orders ADD COLUMN qris_assigned_at DATETIME"); } catch (e) {}
-try { db.exec("ALTER TABLE public_voucher_orders ADD COLUMN qris_paid_notif_id INTEGER"); } catch (e) {}
-try { db.exec("ALTER TABLE public_voucher_orders ADD COLUMN proof_url TEXT DEFAULT ''"); } catch (e) {}
-
-// Kolom untuk Login OLT (Web/API)
-try { db.exec("ALTER TABLE olts ADD COLUMN web_user TEXT DEFAULT 'admin'"); } catch (e) {}
-try { db.exec("ALTER TABLE olts ADD COLUMN web_password TEXT DEFAULT 'admin'"); } catch (e) {}
-try { db.exec("ALTER TABLE olts ADD COLUMN api_base_url TEXT"); } catch (e) {}
-try { db.exec("ALTER TABLE olts ADD COLUMN telnet_port INTEGER DEFAULT 23"); } catch (e) {}
-try { db.exec("ALTER TABLE olts ADD COLUMN enable_password TEXT"); } catch (e) {}
-
-try { db.exec("ALTER TABLE voucher_batches ADD COLUMN updated_at DATETIME DEFAULT (NOW_LOCAL())"); } catch (e) {}
-try { db.exec("ALTER TABLE vouchers ADD COLUMN last_seen_comment TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE vouchers ADD COLUMN last_seen_uptime TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE vouchers ADD COLUMN last_seen_at DATETIME"); } catch (e) {}
-try { db.exec("ALTER TABLE voucher_batches ADD COLUMN mode TEXT DEFAULT 'voucher'"); } catch (e) {}
-try { db.exec("ALTER TABLE voucher_batches ADD COLUMN charset TEXT DEFAULT 'numbers'"); } catch (e) {}
-
-// Relasi notifikasi webhook → invoice (untuk audit)
-try { db.exec("ALTER TABLE webhook_payment_notifs ADD COLUMN matched_invoice_id INTEGER"); } catch (e) {}
-try { db.exec("ALTER TABLE webhook_payment_notifs ADD COLUMN matched_voucher_order_id INTEGER"); } catch (e) {}
-
-try { db.exec("ALTER TABLE agent_transactions ADD COLUMN provider TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE agent_transactions ADD COLUMN digi_sku TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE agent_transactions ADD COLUMN digi_target TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE agent_transactions ADD COLUMN digi_ref_id TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE agent_transactions ADD COLUMN digi_trx_id TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE agent_transactions ADD COLUMN digi_sn TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE agent_transactions ADD COLUMN digi_status TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE agent_transactions ADD COLUMN digi_message TEXT DEFAULT ''"); } catch (e) {}
-try { db.exec("ALTER TABLE agent_transactions ADD COLUMN digi_price INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE agent_transactions ADD COLUMN digi_refunded INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
-try { db.exec("CREATE INDEX IF NOT EXISTS idx_agent_tx_digi_ref ON agent_transactions(digi_ref_id)"); } catch (e) {}
-try { db.exec("CREATE INDEX IF NOT EXISTS idx_agent_tx_type ON agent_transactions(type)"); } catch (e) {}
-
-// Kolom untuk Dynamic Speed & FUP di tabel packages
-try { db.exec("ALTER TABLE packages ADD COLUMN night_speed_down INTEGER DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN night_speed_up INTEGER DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN fup_limit_gb INTEGER DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN fup_speed_down INTEGER DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN use_night_speed INTEGER DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN night_profile_name TEXT"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN use_fup INTEGER DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN fup_profile_name TEXT"); } catch (e) {}
-
-// Promo harga & prorata tagihan pertama (per paket + counter per pelanggan)
-try { db.exec("ALTER TABLE packages ADD COLUMN promo_price INTEGER"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN promo_cycles INTEGER DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN prorate_first_invoice INTEGER DEFAULT 0"); } catch (e) {}
-try { db.exec("ALTER TABLE packages ADD COLUMN router_id INTEGER REFERENCES routers(id) ON DELETE SET NULL"); } catch (e) {}
-try { db.exec("ALTER TABLE customers ADD COLUMN promo_cycles_used INTEGER DEFAULT 0"); } catch (e) {}
+// Tambahkan kolom baru jika belum ada (idempotent, transactional, fail-fast)
+runMigration('legacy additive columns', () => {
+  addColumnIfMissing('customers', 'auto_isolate', 'INTEGER DEFAULT 1');
+  addColumnIfMissing('customers', 'isolate_day', 'INTEGER DEFAULT 10');
+  addColumnIfMissing('customers', 'email', "TEXT DEFAULT ''");
+  addColumnIfMissing('customers', 'router_id', 'INTEGER REFERENCES routers(id) ON DELETE SET NULL');
+  addColumnIfMissing('customers', 'olt_id', 'INTEGER REFERENCES olts(id) ON DELETE SET NULL');
+  addColumnIfMissing('customers', 'pon_port', "TEXT DEFAULT ''");
+  addColumnIfMissing('customers', 'odp_id', 'INTEGER REFERENCES odps(id) ON DELETE SET NULL');
+  addColumnIfMissing('customers', 'lat', 'TEXT');
+  addColumnIfMissing('customers', 'lng', 'TEXT');
+  addColumnIfMissing('customers', 'cable_path', 'TEXT');
+  addColumnIfMissing('customers', 'connection_type', "TEXT DEFAULT 'pppoe'");
+  addColumnIfMissing('customers', 'static_ip', 'TEXT');
+  addColumnIfMissing('customers', 'mac_address', 'TEXT');
+  addColumnIfMissing('customers', 'hotspot_username', "TEXT DEFAULT ''");
+  addColumnIfMissing('customers', 'hotspot_password', "TEXT DEFAULT ''");
+  addColumnIfMissing('customers', 'hotspot_profile', "TEXT DEFAULT ''");
+  addColumnIfMissing('customers', 'pppoe_password', "TEXT DEFAULT ''");
+  addColumnIfMissing('customers', 'pppoe_remote_address', "TEXT DEFAULT ''");
+  addColumnIfMissing('customers', 'wifi_ssid', "TEXT DEFAULT ''");
+  addColumnIfMissing('customers', 'collector_id', 'INTEGER REFERENCES collectors(id) ON DELETE SET NULL');
+  addColumnIfMissing('customers', 'promo_cycles_used', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('customers', 'balance', 'INTEGER NOT NULL DEFAULT 0');
+
+  addColumnIfMissing('collectors', 'auto_approve', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('odps', 'port_capacity', 'INTEGER NOT NULL DEFAULT 16');
+
+  addColumnIfMissing('packages', 'use_ppn', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('packages', 'ppn_percentage', 'REAL DEFAULT 11.0');
+  addColumnIfMissing('packages', 'use_uso', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('packages', 'uso_percentage', 'REAL DEFAULT 1.75');
+  addColumnIfMissing('packages', 'night_speed_down', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('packages', 'night_speed_up', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('packages', 'fup_limit_gb', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('packages', 'fup_speed_down', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('packages', 'use_night_speed', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('packages', 'night_profile_name', 'TEXT');
+  addColumnIfMissing('packages', 'use_fup', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('packages', 'fup_profile_name', 'TEXT');
+  addColumnIfMissing('packages', 'promo_price', 'INTEGER');
+  addColumnIfMissing('packages', 'promo_cycles', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('packages', 'prorate_first_invoice', 'INTEGER DEFAULT 0');
+  addColumnIfMissing('packages', 'router_id', 'INTEGER REFERENCES routers(id) ON DELETE SET NULL');
+
+  addColumnIfMissing('tickets', 'technician_notes', "TEXT DEFAULT ''");
+  addColumnIfMissing('tickets', 'photos', "TEXT DEFAULT ''");
+  addColumnIfMissing('tickets', 'photo_metadata', "TEXT DEFAULT ''");
+  addColumnIfMissing('tickets', 'customer_photos', "TEXT DEFAULT ''");
+  addColumnIfMissing('tickets', 'customer_photo_metadata', "TEXT DEFAULT ''");
+
+  addColumnIfMissing('invoices', 'payment_gateway', 'TEXT');
+  addColumnIfMissing('invoices', 'payment_order_id', 'TEXT');
+  addColumnIfMissing('invoices', 'payment_link', 'TEXT');
+  addColumnIfMissing('invoices', 'payment_reference', 'TEXT');
+  addColumnIfMissing('invoices', 'payment_payload', 'TEXT');
+  addColumnIfMissing('invoices', 'payment_expires_at', 'DATETIME');
+  addColumnIfMissing('invoices', 'qris_unique_code', 'INTEGER');
+  addColumnIfMissing('invoices', 'qris_amount_unique', 'INTEGER');
+  addColumnIfMissing('invoices', 'qris_assigned_at', 'DATETIME');
+  addColumnIfMissing('invoices', 'qris_paid_notif_id', 'INTEGER');
+
+  addColumnIfMissing('public_voucher_orders', 'qris_unique_code', 'INTEGER');
+  addColumnIfMissing('public_voucher_orders', 'qris_amount_unique', 'INTEGER');
+  addColumnIfMissing('public_voucher_orders', 'qris_assigned_at', 'DATETIME');
+  addColumnIfMissing('public_voucher_orders', 'qris_paid_notif_id', 'INTEGER');
+  addColumnIfMissing('public_voucher_orders', 'proof_url', "TEXT DEFAULT ''");
+
+  addColumnIfMissing('olts', 'web_user', "TEXT DEFAULT 'admin'");
+  addColumnIfMissing('olts', 'web_password', "TEXT DEFAULT 'admin'");
+  addColumnIfMissing('olts', 'api_base_url', 'TEXT');
+  addColumnIfMissing('olts', 'telnet_port', 'INTEGER DEFAULT 23');
+  addColumnIfMissing('olts', 'enable_password', 'TEXT');
+
+  addColumnIfMissing('voucher_batches', 'updated_at', 'DATETIME DEFAULT (NOW_LOCAL())');
+  addColumnIfMissing('voucher_batches', 'mode', "TEXT DEFAULT 'voucher'");
+  addColumnIfMissing('voucher_batches', 'charset', "TEXT DEFAULT 'numbers'");
+  addColumnIfMissing('vouchers', 'last_seen_comment', "TEXT DEFAULT ''");
+  addColumnIfMissing('vouchers', 'last_seen_uptime', "TEXT DEFAULT ''");
+  addColumnIfMissing('vouchers', 'last_seen_at', 'DATETIME');
+
+  addColumnIfMissing('webhook_payment_notifs', 'matched_invoice_id', 'INTEGER');
+  addColumnIfMissing('webhook_payment_notifs', 'matched_voucher_order_id', 'INTEGER');
+
+  addColumnIfMissing('agent_transactions', 'provider', "TEXT DEFAULT ''");
+  addColumnIfMissing('agent_transactions', 'digi_sku', "TEXT DEFAULT ''");
+  addColumnIfMissing('agent_transactions', 'digi_target', "TEXT DEFAULT ''");
+  addColumnIfMissing('agent_transactions', 'digi_ref_id', "TEXT DEFAULT ''");
+  addColumnIfMissing('agent_transactions', 'digi_trx_id', "TEXT DEFAULT ''");
+  addColumnIfMissing('agent_transactions', 'digi_sn', "TEXT DEFAULT ''");
+  addColumnIfMissing('agent_transactions', 'digi_status', "TEXT DEFAULT ''");
+  addColumnIfMissing('agent_transactions', 'digi_message', "TEXT DEFAULT ''");
+  addColumnIfMissing('agent_transactions', 'digi_price', 'INTEGER NOT NULL DEFAULT 0');
+  addColumnIfMissing('agent_transactions', 'digi_refunded', 'INTEGER NOT NULL DEFAULT 0');
+  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_tx_digi_ref ON agent_transactions(digi_ref_id)');
+  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_tx_type ON agent_transactions(type)');
+});
+
+
+function encryptExistingSecretsAtRest() {
+  const { encryptValue, isEncryptedValue } = require('./settingsEncryption');
+  const jobs = [
+    { table: 'routers', columns: ['password'] },
+    { table: 'olts', columns: ['snmp_community', 'web_password', 'enable_password'] },
+    { table: 'genieacs_servers', columns: ['password'] },
+    { table: 'customers', columns: ['pppoe_password', 'hotspot_password'] }
+  ];
+
+  runMigration('encrypt existing device secrets', () => {
+    for (const job of jobs) {
+      if (!tableExists(job.table)) continue;
+      const existingColumns = db.prepare(`PRAGMA table_info(${job.table})`).all().map((col) => col.name);
+      const columns = job.columns.filter((column) => existingColumns.includes(column));
+      if (!columns.length) continue;
+      const rows = db.prepare(`SELECT id, ${columns.join(', ')} FROM ${job.table}`).all();
+      for (const row of rows) {
+        const updates = [];
+        const values = [];
+        for (const column of columns) {
+          const value = row[column];
+          if (typeof value === 'string' && value.trim() && !isEncryptedValue(value)) {
+            updates.push(`${column} = ?`);
+            values.push(encryptValue(value));
+          }
+        }
+        if (updates.length) {
+          values.push(row.id);
+          db.prepare(`UPDATE ${job.table} SET ${updates.join(', ')} WHERE id = ?`).run(...values);
+        }
+      }
+    }
+  });
+}
+
+encryptExistingSecretsAtRest();
 
 // Tabel untuk Tracking Pemakaian (Usage) Pelanggan
 db.exec(`
   CREATE TABLE IF NOT EXISTS customer_usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
     period_month INTEGER NOT NULL,
     period_year INTEGER NOT NULL,
     bytes_in INTEGER DEFAULT 0,
     bytes_out INTEGER DEFAULT 0,
     last_total_bytes_in INTEGER DEFAULT 0, -- Untuk menghitung delta
     last_total_bytes_out INTEGER DEFAULT 0,
     updated_at DATETIME DEFAULT (NOW_LOCAL()),
     UNIQUE(customer_id, period_month, period_year)
   );
   CREATE INDEX IF NOT EXISTS idx_usage_customer ON customer_usage(customer_id);
   CREATE INDEX IF NOT EXISTS idx_usage_period ON customer_usage(period_month, period_year);
 `);
 
 db.exec(`
   CREATE TABLE IF NOT EXISTS digiflazz_products (
     sku TEXT PRIMARY KEY,
     product_name TEXT NOT NULL,
     category TEXT DEFAULT '',
     brand TEXT DEFAULT '',
