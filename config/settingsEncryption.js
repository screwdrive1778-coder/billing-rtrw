/**
 * Settings Encryption & Decryption
 * AES-256-GCM for sensitive values stored in JSON/SQLite.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

const DEFAULT_MASTER_KEY = 'default-master-key-change-this-in-production';
const LOCAL_KEY_PATH = process.env.SETTINGS_KEY_FILE || path.join(__dirname, '.settings.key');

function readOrCreateLocalKey() {
  if (process.env.SETTINGS_MASTER_KEY && String(process.env.SETTINGS_MASTER_KEY).trim()) {
    return String(process.env.SETTINGS_MASTER_KEY).trim();
  }
  try {
    if (fs.existsSync(LOCAL_KEY_PATH)) return fs.readFileSync(LOCAL_KEY_PATH, 'utf8').trim();
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(LOCAL_KEY_PATH, key, { mode: 0o600 });
    try { fs.chmodSync(LOCAL_KEY_PATH, 0o600); } catch {}
    logger.warn(`[encryption] SETTINGS_MASTER_KEY is not set; generated local key at ${LOCAL_KEY_PATH}. Back it up or set SETTINGS_MASTER_KEY before production deployment.`);
    return key;
  } catch (error) {
    logger.error(`[encryption] Failed to read/create local encryption key: ${error.message}`);
    return DEFAULT_MASTER_KEY;
  }
}

const MASTER_KEY = readOrCreateLocalKey();

function getMasterKeyForString(keyStr) {
  return crypto.createHash('sha256').update(keyStr || '').digest();
}

function getMasterKey() {
  return getMasterKeyForString(MASTER_KEY);
}

const SENSITIVE_FIELDS = [
  'genieacs_password', 'admin_password', 'admin_api_key', 'mikrotik_password',
  'tripay_api_key', 'tripay_private_key', 'midtrans_server_key', 'telegram_bot_token',
  'xendit_api_key', 'duitku_api_key', 'digiflazz_api_key', 'digiflazz_webhook_secret',
  'session_secret', 'web_password', 'enable_password', 'snmp_community', 'password'
];

function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

function encryptValue(value) {
  if (!value || typeof value !== 'string') return value;
  if (isEncryptedValue(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptWithKey(encryptedValue, key) {
  const parts = encryptedValue.split(':');
  if (parts.length === 5 && parts[0] === 'enc' && parts[1] === 'v1') {
    const [, , ivB64, authTagB64, encryptedB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedB64, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  }
  if (parts.length === 4 && parts[0] === 'enc') {
    const [, ivHex, authTagHex, encrypted] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
  throw new Error('Invalid encrypted value format');
}

function decryptValue(encryptedValue) {
  if (!encryptedValue || typeof encryptedValue !== 'string') return encryptedValue;
  if (!encryptedValue.startsWith('enc:')) return encryptedValue;
  try {
    return decryptWithKey(encryptedValue, getMasterKey());
  } catch (error) {
    try {
      return decryptWithKey(encryptedValue, getMasterKeyForString(DEFAULT_MASTER_KEY));
    } catch (fallbackError) {
      logger.error(`[encryption] Error decrypting value: ${fallbackError.message}`);
      return encryptedValue;
    }
  }
}

function encryptSettings(settings) {
  const encrypted = { ...settings };
  SENSITIVE_FIELDS.forEach((field) => {
    if (encrypted[field]) encrypted[field] = encryptValue(String(encrypted[field]));
  });
  return encrypted;
}

function decryptSettings(settings) {
  const decrypted = { ...settings };
  SENSITIVE_FIELDS.forEach((field) => {
    if (decrypted[field]) decrypted[field] = decryptValue(decrypted[field]);
  });
  return decrypted;
}

function maskValue(value) {
  if (!value || typeof value !== 'string') return value;
  const plain = decryptValue(value);
  if (plain.length <= 8) return '****';
  return `${plain.substring(0, 4)}****${plain.substring(plain.length - 4)}`;
}

function getMaskedSettings(settings) {
  const masked = { ...settings };
  SENSITIVE_FIELDS.forEach((field) => {
    if (masked[field]) masked[field] = maskValue(masked[field]);
  });
  return masked;
}

function isSensitiveField(field) { return SENSITIVE_FIELDS.includes(field); }

module.exports = { encryptValue, decryptValue, encryptSettings, decryptSettings, maskValue, getMaskedSettings, isSensitiveField, isEncryptedValue, SENSITIVE_FIELDS };
