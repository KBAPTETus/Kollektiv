import { Router } from 'express';
import { db } from '../db.js';

export const listingsRouter = Router();

// GET /api/listings (с поддержкой фильтров и дельта-синхронизации)
listingsRouter.get('/', (req, res) => {
  const { type, category, location, search, since } = req.query;

  let query = 'SELECT * FROM listings WHERE 1=1';
  const params = [];

  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }

  if (category && category !== 'all') {
    query += ' AND category_id = ?';
    params.push(category);
  }

  if (location && location !== 'all') {
    query += ' AND location_name = ?';
    params.push(location);
  }

  if (search) {
    query += ' AND (title LIKE ? OR description LIKE ? OR address_detail LIKE ?)';
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  // Дельта-синхронизация: запрашиваем только то, что обновилось после указанной даты
  if (since) {
    query += ' AND updated_at > ?';
    params.push(since);
  }

  // Бустнутые объявления первыми, затем самые свежие
  query += ' ORDER BY is_boosted DESC, datetime(created_at) DESC';

  const stmt = db.prepare(query);
  const rows = stmt.all(...params);

  res.json({
    items: rows,
    meta: {
      count: rows.length,
      server_time: new Date().toISOString(),
      is_delta: Boolean(since)
    }
  });
});

// GET /api/listings/:id
listingsRouter.get('/:id', (req, res) => {
  const stmt = db.prepare('SELECT * FROM listings WHERE id = ?');
  const item = stmt.get(req.params.id);

  if (!item) {
    return res.status(404).json({ error: 'Объявление не найдено' });
  }

  res.json(item);
});

// POST /api/listings (создание нового объявления)
listingsRouter.post('/', (req, res) => {
  const {
    title,
    description,
    type,
    category_id,
    location_name,
    address_detail,
    price,
    price_unit,
    contact_name,
    contact_phone,
    contact_telegram,
    image_url
  } = req.body;

  if (!title || !type || !location_name || !contact_name) {
    return res.status(400).json({
      error: 'Обязательные поля: title, type, location_name, contact_name'
    });
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO listings (
      title, description, type, category_id, location_name, address_detail,
      price, price_unit, contact_name, contact_phone, contact_telegram,
      image_url, is_boosted, boosted_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
  `);

  const result = stmt.run(
    title,
    description || '',
    type,
    category_id || (type === 'goods' ? 'eggs' : 'septic'),
    location_name,
    address_detail || '',
    Number(price) || 0,
    price_unit || (type === 'goods' ? 'руб/ед' : 'руб/услуга'),
    contact_name,
    contact_phone || '',
    contact_telegram || '',
    image_url || '',
    now,
    now
  );

  const getStmt = db.prepare('SELECT * FROM listings WHERE id = ?');
  const created = getStmt.get(result.lastInsertRowid);

  res.status(201).json(created);
});

// POST /api/listings/:id/boost (Оплата буста / закрепления через СБП/ЮKassa)
listingsRouter.post('/:id/boost', (req, res) => {
  const id = req.params.id;
  const days = Number(req.body.days) || 7;

  const boostUntil = new Date(Date.now() + days * 24 * 3600000).toISOString();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE listings 
    SET is_boosted = 1, boosted_until = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(boostUntil, now, id);

  res.json({
    success: true,
    message: `Объявление #${id} успешно поднято в ТОП района на ${days} дней!`,
    boosted_until: boostUntil,
    receipt: {
      provider: 'Плательщик НПД (Самозанятый)',
      service: 'Услуга продвижения объявления в каталоге Kollektiv',
      amount_rub: 49,
      tax_rate: '4%',
      status: 'Оплачено (Тестовый режим эквайринга)'
    }
  });
});
