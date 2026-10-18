import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'kollektiv.db');

export const db = new DatabaseSync(DB_PATH);

export function initDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      lat REAL,
      lon REAL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('goods', 'services'))
    );

    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL CHECK(type IN ('goods', 'services')),
      category_id TEXT NOT NULL,
      location_id INTEGER,
      location_name TEXT NOT NULL,
      address_detail TEXT,
      price INTEGER DEFAULT 0,
      price_unit TEXT DEFAULT 'руб',
      contact_name TEXT NOT NULL,
      contact_phone TEXT,
      contact_telegram TEXT,
      image_url TEXT,
      is_boosted INTEGER DEFAULT 0,
      boosted_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      telegram_username TEXT,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('basic', 'pro', 'verified')) DEFAULT 'basic',
      inn TEXT,
      verified_doc TEXT,
      auth_token TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL,
      reporter_info TEXT,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'resolved', 'dismissed')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_listings_type ON listings(type);
    CREATE INDEX IF NOT EXISTS idx_listings_location ON listings(location_name);
    CREATE INDEX IF NOT EXISTS idx_listings_updated ON listings(updated_at);
    CREATE INDEX IF NOT EXISTS idx_listings_boost ON listings(is_boosted DESC, updated_at DESC);

    -- Граф причинно-следственных связей между категориями и потребностями
    CREATE TABLE IF NOT EXISTS graph_edges (
      source_category TEXT NOT NULL,
      target_category TEXT NOT NULL,
      relation_type TEXT NOT NULL, -- 'tool', 'complement', 'lifecycle', 'seasonal'
      label TEXT NOT NULL,          -- читаемый лейбл связи: 'Необходимый инструмент', 'С этим покупают'
      weight REAL DEFAULT 1.0,     -- сила связи от 0.1 до 1.0
      PRIMARY KEY (source_category, target_category)
    );

    CREATE INDEX IF NOT EXISTS idx_graph_edges_lookup ON graph_edges(source_category, weight DESC);
  `);

  // Миграция колонок listings и users для существующих баз данных
  try {
    const listCols = db.prepare("PRAGMA table_info(listings)").all().map(c => c.name);
    if (!listCols.includes('user_id')) {
      db.exec("ALTER TABLE listings ADD COLUMN user_id INTEGER;");
    }
    if (!listCols.includes('status')) {
      db.exec("ALTER TABLE listings ADD COLUMN status TEXT DEFAULT 'active';");
    }
    if (!listCols.includes('expires_at')) {
      db.exec("ALTER TABLE listings ADD COLUMN expires_at TEXT;");
    }

    const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userCols.includes('is_verified')) {
      db.exec("ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0;");
    }
  } catch (err) {
    console.error('Ошибка миграции колонок:', err);
  }

  console.log('✅ [Database] SQLite инициализирована успешно (WAL-режим включен, таблицы users/reports/listings синхронизированы).');
}
